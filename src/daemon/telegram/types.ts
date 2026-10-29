// ponytail: only the Bot API fields barista reads; extend when a feature needs more.

export type MessageEntity = {
  type: string
  offset: number
  length: number
  url?: string
  language?: string
  user?: User
}

export type User = { id: number; first_name: string; username?: string; is_bot?: boolean }

export type Chat = {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
  first_name?: string
  is_forum?: boolean
}

export type FileRef = { file_id: string; file_size?: number; file_name?: string; mime_type?: string }

export type Message = {
  message_id: number
  message_thread_id?: number
  is_topic_message?: boolean
  from?: User
  chat: Chat
  date: number
  text?: string
  entities?: MessageEntity[]
  caption?: string
  caption_entities?: MessageEntity[]
  media_group_id?: string
  photo?: FileRef[]
  video?: FileRef
  document?: FileRef
  audio?: FileRef
  voice?: FileRef
  video_note?: FileRef
  animation?: FileRef
  sticker?: unknown
  poll?: unknown
  reply_to_message?: Message
  quote?: { text: string }
  location?: unknown
  contact?: unknown
  forum_topic_created?: { name: string }
  new_chat_members?: User[]
  left_chat_member?: User
  migrate_to_chat_id?: number
  forum_topic_edited?: { name?: string }
}

export type ChatMemberUpdated = { chat: Chat; from: User; new_chat_member: { status: string } }

export type Update = {
  update_id: number
  message?: Message
  edited_message?: Message
  my_chat_member?: ChatMemberUpdated
}

export type ForumTopic = { message_thread_id: number; name: string }

export type BotInfo = User & { can_read_all_group_messages?: boolean }
