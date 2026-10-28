import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { BaristaError } from './errors.ts'
import { splitText } from './format/split.ts'
import { TelegramError, type Api } from './telegram/api.ts'

export type Target = { chatId: number; threadId?: number }
export type OutboundFile = { path: string; caption?: string }

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
  for (const chunk of splitText(markdown)) ids.push(...(await sendChunk(api, target, chunk)))
  return ids
}

async function sendChunk(api: Api, target: Target, markdown: string): Promise<number[]> {
  try {
    const sent = await api.call<Sent>('sendRichMessage', { ...where(target), rich_message: { markdown } })
    return [sent.message_id]
  } catch (error) {
    if (!(error instanceof TelegramError) || error.status !== 400) throw error
    const ids: number[] = []
    for (const text of splitText(markdown, PLAIN_LIMIT)) {
      ids.push((await api.call<Sent>('sendMessage', { ...where(target), text })).message_id)
    }
    return ids
  }
}

/** Sends files as photos/videos/audio/documents; photos and videos together go as albums of up to 10. */
export async function sendFiles(api: Api, target: Target, files: OutboundFile[], caption?: string): Promise<number[]> {
  const prepared = await Promise.all(files.map(prepare))
  const groups = groupForAlbums(prepared)
  const ids: number[] = []
  for (const [index, group] of groups.entries()) {
    const groupCaption = index === 0 ? caption : undefined
    ids.push(...(group.length === 1 ? await sendOne(api, target, group[0], groupCaption) : await sendAlbum(api, target, group, groupCaption)))
  }
  return ids
}

export async function postNotice(api: Api, target: Target, text: string): Promise<number> {
  return (await api.call<Sent>('sendMessage', { ...where(target), text, disable_notification: false })).message_id
}

export async function deleteMessage(api: Api, chatId: number, messageId: number): Promise<void> {
  await api.call('deleteMessage', { chat_id: chatId, message_id: messageId })
}

export function where(target: Target): { chat_id: number; message_thread_id?: number } {
  return { chat_id: target.chatId, message_thread_id: target.threadId }
}

async function prepare(file: OutboundFile): Promise<Prepared> {
  const info = await stat(file.path).catch(() => undefined)
  if (!info?.isFile()) throw new BaristaError('FILE_NOT_FOUND', `No file at ${file.path}.`, 'Pass an absolute path to an existing file.')
  if (info.size > UPLOAD_LIMIT) throw new BaristaError('FILE_TOO_BIG', `${file.path} is over 50 MB.`, 'Telegram bots cannot upload more; compress or split it.')
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
  const params = { ...where(target), caption: file.caption ?? caption }
  return [(await api.upload<Sent>(METHOD[file.kind], params, { [file.kind]: file.path })).message_id]
}

async function sendAlbum(api: Api, target: Target, files: Prepared[], caption?: string): Promise<number[]> {
  const media = files.map((file, i) => ({ type: file.kind, media: `attach://f${i}`, caption: file.caption ?? (i === 0 ? caption : undefined) }))
  const attachments = Object.fromEntries(files.map((file, i) => [`f${i}`, file.path]))
  const sent = await api.upload<Sent[]>('sendMediaGroup', { ...where(target), media }, attachments)
  return sent.map(m => m.message_id)
}
