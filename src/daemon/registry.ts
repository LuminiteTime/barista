import type { BindingView } from '../../mod/hooks/protocol.ts'
import { BaristaError } from './errors.ts'
import type { Chat, Message, Update } from './telegram/types.ts'

export type ChatEntry = { id: number; title: string; isPrivate: boolean; isForum: boolean; topics: Record<string, string> }

const GENERAL = 'general'
const GONE = new Set(['left', 'kicked'])

/** What the bot has seen: Bot API cannot list a bot's chats or a forum's topics, so we learn them from updates. */
export class Registry {
  private chats = new Map<number, ChatEntry>()

  static fromJSON(entries: ChatEntry[]): Registry {
    const registry = new Registry()
    for (const entry of entries) registry.chats.set(entry.id, entry)
    return registry
  }

  toJSON(): ChatEntry[] {
    return [...this.chats.values()]
  }

  list(): ChatEntry[] {
    return this.toJSON()
  }

  get(chatId: number): ChatEntry | undefined {
    return this.chats.get(chatId)
  }

  observe(update: Update): void {
    const member = update.my_chat_member
    if (member && GONE.has(member.new_chat_member.status)) this.chats.delete(member.chat.id)
    else if (member) this.learnChat(member.chat)
    const message = update.message ?? update.edited_message
    if (message) this.observeMessage(message)
  }

  addTopic(chatId: number, threadId: number, name: string): void {
    const entry = this.chats.get(chatId)
    if (entry) entry.topics[threadId] = name
  }

  resolve(chatName: string, topicName?: string): BindingView {
    const chat = this.findChat(chatName)
    if (!chat.isForum) {
      if (topicName) throw new BaristaError('NOT_FORUM', `"${chat.title}" has no topics.`, 'Bind the chat without a topic.')
      return { chatId: chat.id, title: chat.title }
    }
    if (!topicName) throw topicRequired(chat)
    return this.findTopic(chat, topicName)
  }

  findChat(name: string): ChatEntry {
    const wanted = normalize(name)
    const chat = [...this.chats.values()].find(c => normalize(c.title) === wanted || String(c.id) === wanted)
    if (chat) return chat
    throw new BaristaError(
      'CHAT_UNKNOWN',
      `The bot has not seen a chat named "${name}".`,
      'Add the bot to the chat (admin for forums) and send any message there, or bind by chat id.',
    )
  }

  private findTopic(chat: ChatEntry, name: string): BindingView {
    const wanted = normalize(name)
    if (wanted === GENERAL) return { chatId: chat.id, title: `${chat.title} / General` }
    const found = Object.entries(chat.topics).find(([, topic]) => normalize(topic) === wanted)
    if (found) return { chatId: chat.id, threadId: Number(found[0]), title: `${chat.title} / ${found[1]}` }
    throw new BaristaError(
      'TOPIC_UNKNOWN',
      `No known topic "${name}" in "${chat.title}". Known: ${topicNames(chat)}.`,
      'Send any message in that topic so the bot learns it, or bind with --create.',
    )
  }

  private observeMessage(message: Message): void {
    const entry = this.learnChat(message.chat)
    const thread = message.message_thread_id
    const name =
      message.forum_topic_created?.name ??
      message.forum_topic_edited?.name ??
      (message.is_topic_message ? message.reply_to_message?.forum_topic_created?.name : undefined)
    if (thread && name) entry.topics[thread] = name
  }

  learnChat(chat: Chat): ChatEntry {
    const known = this.chats.get(chat.id)
    const entry: ChatEntry = {
      id: chat.id,
      title: chat.title ?? `${chat.first_name ?? chat.username ?? chat.id} (private)`,
      isPrivate: chat.type === 'private',
      isForum: chat.is_forum === true,
      topics: known?.topics ?? {},
    }
    this.chats.set(chat.id, entry)
    return entry
  }
}

function normalize(name: string): string {
  return name.trim().toLowerCase()
}

function topicNames(chat: ChatEntry): string {
  return ['General', ...Object.values(chat.topics)].join(', ')
}

function topicRequired(chat: ChatEntry): BaristaError {
  return new BaristaError(
    'TOPIC_REQUIRED',
    `"${chat.title}" is split into topics; bind a topic. Known: ${topicNames(chat)}.`,
    'Use: /tg bind <chat> / <topic>',
  )
}
