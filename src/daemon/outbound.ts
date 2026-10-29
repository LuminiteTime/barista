import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { BaristaError } from './errors.ts'
import { splitText } from './format/split.ts'
import type { NoticeButton } from '../../mod/hooks/protocol.ts'
import { TelegramError, type Api } from './telegram/api.ts'

/** Where a message goes; `replyTo` makes the first message sent a reply to that message. */
export type Target = { chatId: number; threadId?: number; replyTo?: number }
export type OutboundFile = { path: string; caption?: string }
export type SentFiles = { messageIds: number[]; skipped: string[] }

/** Bot API upload cap for bots. */
export const UPLOAD_LIMIT = 50 * 1024 * 1024
const PHOTO_LIMIT = 10 * 1024 * 1024
const PLAIN_LIMIT = 4096
const ALBUM_MAX = 10
const KIND_BY_EXT: Record<string, Kind> = {
  '.jpg': 'photo', '.jpeg': 'photo', '.png': 'photo', '.webp': 'photo',
  '.mp4': 'video', '.mov': 'video', '.m4v': 'video',
  '.mp3': 'audio', '.m4a': 'audio', '.flac': 'audio', '.wav': 'audio',
}
const METHOD: Record<Kind, string> = { photo: 'sendPhoto', video: 'sendVideo', audio: 'sendAudio', document: 'sendDocument' }

type Kind = 'photo' | 'video' | 'audio' | 'document'
type Prepared = OutboundFile & { kind: Kind }
type Sent = { message_id: number }

/** Sends Claude's Markdown as rich messages; falls back to plain text if Telegram rejects the markup. */
export async function sendText(api: Api, target: Target, markdown: string): Promise<number[]> {
  const ids: number[] = []
  for (const [index, chunk] of splitText(markdown).entries()) ids.push(...(await sendChunk(api, onlyFirst(target, index), chunk)))
  return ids
}

async function sendChunk(api: Api, target: Target, markdown: string): Promise<number[]> {
  try {
    const sent = await api.call<Sent>('sendRichMessage', { ...addressed(target), rich_message: { markdown } })
    return [sent.message_id]
  } catch (error) {
    if (!(error instanceof TelegramError) || error.status !== 400) throw error
    const ids: number[] = []
    for (const [index, text] of splitText(markdown, PLAIN_LIMIT).entries()) {
      ids.push((await api.call<Sent>('sendMessage', { ...addressed(onlyFirst(target, index)), text })).message_id)
    }
    return ids
  }
}

/**
 * Sends files as photos/videos/audio/documents; photos and videos together go as albums of up to 10.
 * A file that cannot go (missing, over 50 MB) is skipped and named; only when none can go is it an error.
 */
export async function sendFiles(api: Api, target: Target, files: OutboundFile[], caption?: string): Promise<SentFiles> {
  const checked = await Promise.all(files.map(prepare))
  const refused = checked.filter((c): c is BaristaError => c instanceof BaristaError)
  const prepared = checked.filter((c): c is Prepared => !(c instanceof BaristaError))
  if (prepared.length === 0) throw refused[0]
  const ids: number[] = []
  for (const [index, group] of groupForAlbums(prepared).entries()) {
    const to = onlyFirst(target, index)
    const groupCaption = index === 0 ? caption : undefined
    ids.push(...(group.length === 1 ? await sendOne(api, to, group[0], groupCaption) : await sendAlbum(api, to, group, groupCaption)))
  }
  return { messageIds: ids, skipped: refused.map(error => error.message) }
}

export async function postNotice(api: Api, target: Target, text: string, buttons?: NoticeButton[][]): Promise<number> {
  return (await api.call<Sent>('sendMessage', { ...where(target), text, disable_notification: false, ...keyboard(buttons) })).message_id
}

export async function editNotice(api: Api, { chatId, messageId }: { chatId: number; messageId: number }, text: string, buttons?: NoticeButton[][]): Promise<void> {
  await api.call('editMessageText', { chat_id: chatId, message_id: messageId, text, ...keyboard(buttons) })
}

function keyboard(buttons?: NoticeButton[][]) {
  if (!buttons?.length) return {}
  return { reply_markup: { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.text, callback_data: b.data }))) } }
}

export async function deleteMessage(api: Api, chatId: number, messageId: number): Promise<void> {
  await api.call('deleteMessage', { chat_id: chatId, message_id: messageId })
}

export function where(target: Target): { chat_id: number; message_thread_id?: number } {
  return { chat_id: target.chatId, message_thread_id: target.threadId }
}

/** `where`, plus the reply; a deleted original still lets the message through. */
function addressed(target: Target) {
  const reply = target.replyTo === undefined ? undefined : { message_id: target.replyTo, allow_sending_without_reply: true }
  return { ...where(target), reply_parameters: reply }
}

function onlyFirst(target: Target, index: number): Target {
  return index === 0 ? target : { ...target, replyTo: undefined }
}

async function prepare(file: OutboundFile): Promise<Prepared | BaristaError> {
  const info = await stat(file.path).catch(() => undefined)
  if (!info?.isFile()) return new BaristaError('FILE_NOT_FOUND', `No file at ${file.path}.`, 'Pass an absolute path to an existing file.')
  if (info.size > UPLOAD_LIMIT) return new BaristaError('FILE_TOO_BIG', `${file.path} is over 50 MB.`, 'Telegram bots cannot upload more; compress or split it.')
  const kind = KIND_BY_EXT[extname(file.path).toLowerCase()] ?? 'document'
  return { ...file, kind: kind === 'photo' && info.size > PHOTO_LIMIT ? 'document' : kind }
}

function groupForAlbums(files: Prepared[]): Prepared[][] {
  const visual = files.filter(f => f.kind === 'photo' || f.kind === 'video')
  const rest = files.filter(f => !visual.includes(f))
  const byKind = [visual, ...['audio', 'document'].map(kind => rest.filter(f => f.kind === kind))]
  return byKind.flatMap(chunk)
}

function chunk(files: Prepared[]): Prepared[][] {
  const chunks: Prepared[][] = []
  for (let i = 0; i < files.length; i += ALBUM_MAX) chunks.push(files.slice(i, i + ALBUM_MAX))
  return chunks
}

async function sendOne(api: Api, target: Target, file: Prepared, caption?: string): Promise<number[]> {
  const params = { ...addressed(target), caption: file.caption ?? caption }
  return [(await api.upload<Sent>(METHOD[file.kind], params, { [file.kind]: file.path })).message_id]
}

async function sendAlbum(api: Api, target: Target, files: Prepared[], caption?: string): Promise<number[]> {
  const media = files.map((file, i) => ({ type: file.kind, media: `attach://f${i}`, caption: file.caption ?? (i === 0 ? caption : undefined) }))
  const attachments = Object.fromEntries(files.map((file, i) => [`f${i}`, file.path]))
  const sent = await api.upload<Sent[]>('sendMediaGroup', { ...addressed(target), media }, attachments)
  return sent.map(m => m.message_id)
}
