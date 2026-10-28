import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { InboundMessage } from '../../../mod/hooks/protocol.ts'
import { entitiesToMarkdown } from '../format/entities.ts'
import type { FileRef, Message } from '../telegram/types.ts'
import { threadOf } from './route.ts'

/** Bot API getFile refuses files above this size. */
export const DOWNLOAD_LIMIT = 20 * 1024 * 1024
const QUOTE_LIMIT = 300
const AUDIO_KINDS = new Set(['voice', 'audio'])

export type InboundDeps = {
  filesDir: string
  download: (fileId: string, dir: string, name?: string) => Promise<string>
  transcribe: (path: string) => Promise<string | undefined>
}

type Attachment = { kind: string; file: FileRef }

/** Turns one message (or one album) into the prompt payload, downloading its files. */
export async function buildInbound(messages: Message[], title: string, deps: InboundDeps): Promise<InboundMessage> {
  const first = messages[0]
  const inbound: InboundMessage = {
    kind: 'message',
    chatId: first.chat.id,
    messageIds: messages.map(m => m.message_id),
    header: `[Telegram · ${title}]`,
    text: messages.map(textOf).filter(Boolean).join('\n\n'),
    replyTo: quoteOf(first),
    files: [],
  }
  const dir = join(deps.filesDir, String(first.chat.id), String(threadOf(first) ?? 'main'))
  await mkdir(dir, { recursive: true })
  for (const message of messages) await attach(inbound, message, dir, deps)
  return inbound
}

async function attach(inbound: InboundMessage, message: Message, dir: string, deps: InboundDeps): Promise<void> {
  for (const { kind, file } of attachmentsOf(message)) {
    if ((file.file_size ?? 0) > DOWNLOAD_LIMIT) {
      addNote(inbound, `FILE_TOO_BIG: ${file.file_name ?? kind} is over 20 MB, Telegram bots cannot download it.`)
      continue
    }
    const name = file.file_name ? `${message.message_id}-${basename(file.file_name)}` : undefined
    const path = await deps.download(file.file_id, dir, name).catch(() => undefined)
    if (!path) {
      addNote(inbound, `The ${kind} ${file.file_name ?? ''} could not be downloaded from Telegram.`)
      continue
    }
    inbound.files.push(path)
    if (AUDIO_KINDS.has(kind)) inbound.transcript = await deps.transcribe(path)
  }
}

export function addNote(inbound: InboundMessage, note: string): void {
  inbound.note = inbound.note ? `${inbound.note}\n${note}` : note
}

function attachmentsOf(message: Message): Attachment[] {
  const list: Attachment[] = []
  if (message.photo?.length) list.push({ kind: 'photo', file: message.photo[message.photo.length - 1] })
  for (const kind of ['video', 'document', 'audio', 'voice', 'video_note', 'animation'] as const) {
    const file = message[kind]
    if (file) list.push({ kind, file })
  }
  return list
}

function textOf(message: Message): string {
  if (message.text) return entitiesToMarkdown(message.text, message.entities)
  return message.caption ? entitiesToMarkdown(message.caption, message.caption_entities) : ''
}

function quoteOf(message: Message): string | undefined {
  const reply = message.reply_to_message
  const isTopicRoot = message.is_topic_message && reply?.message_id === message.message_thread_id
  if (!reply || reply.forum_topic_created || isTopicRoot) return undefined
  const text = message.quote?.text ?? (textOf(reply) || '[media]')
  return text.length > QUOTE_LIMIT ? text.slice(0, QUOTE_LIMIT) + '…' : text
}
