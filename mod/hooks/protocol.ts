// Wire contract between the daemon and the mod (JSON over a unix socket).
// Types only: both sides import it with `import type`, so nothing crosses at runtime.

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'CHAT_UNKNOWN'
  | 'DAEMON_DOWN'
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_BIG'
  | 'NOT_BOUND'
  | 'NOT_FORUM'
  | 'NO_RIGHTS'
  | 'PRIVACY_MODE'
  | 'TG_API'
  | 'TOPIC_REQUIRED'
  | 'TOPIC_TAKEN'
  | 'TOPIC_UNKNOWN'

export type ErrorBody = { error: { code: ErrorCode; message: string; hint?: string } }

export type BindingView = { chatId: number; threadId?: number; title: string }

export type Stage = 'queued' | 'working' | 'waiting' | 'done' | 'aborted' | 'failed'

export type InboundMessage = {
  kind: 'message'
  chatId: number
  messageIds: number[]
  header: string
  text: string
  replyTo?: string
  files: string[]
  transcript?: string
  note?: string
}

export type StopRequest = { kind: 'stop' }

export type InboxItem = InboundMessage | StopRequest

export type BindRequest = { sessionId: string; chat: string; topic?: string; create?: boolean; force?: boolean }
export type AttachRequest = { sessionId: string; previousSessionId?: string }
export type SendRequest = { sessionId: string; text: string }
export type SendFilesRequest = { sessionId: string; files: { path: string; caption?: string }[]; caption?: string }
export type StatusRequest = { sessionId: string; chatId: number; messageIds: number[]; stage: Stage }
export type NoticeRequest = { sessionId: string; key: string; text: string }

export type Health = { version: string; bot: string; canReadGroups: boolean; uptimeMs: number }
