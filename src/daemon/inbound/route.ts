import type { Binding, Bindings } from '../bindings.ts'
import type { Message, Update } from '../telegram/types.ts'

export type RouteContext = { ownerId: number; bindings: Bindings; now: number }

export type Route =
  | { kind: 'drop' }
  | { kind: 'stop'; binding: Binding }
  | { kind: 'unsupported'; binding: Binding; message: Message }
  | { kind: 'deliver'; binding: Binding; message: Message }

const STOP = /^\/stop(@\w+)?\s*$/
const CONTENT_KEYS = ['text', 'caption', 'photo', 'video', 'document', 'audio', 'voice', 'video_note', 'animation'] as const
const UNSUPPORTED_KEYS = ['sticker', 'poll', 'location', 'contact'] as const

/** Decides what an update means for which session. Pure: no I/O. */
export function routeUpdate(update: Update, { ownerId, bindings, now }: RouteContext): Route {
  const message = update.message
  if (!message || message.from?.id !== ownerId) return { kind: 'drop' }
  const binding = bindings.targetFor(message.chat.id, threadOf(message), now)
  if (!binding) return { kind: 'drop' }
  if (message.text && STOP.test(message.text)) return { kind: 'stop', binding }
  if (CONTENT_KEYS.some(key => message[key] !== undefined)) return { kind: 'deliver', binding, message }
  if (UNSUPPORTED_KEYS.some(key => message[key] !== undefined)) return { kind: 'unsupported', binding, message }
  return { kind: 'drop' }
}

/** Forum topic of a message; undefined for General and for chats without topics. */
export function threadOf(message: Message): number | undefined {
  return message.is_topic_message ? message.message_thread_id : undefined
}
