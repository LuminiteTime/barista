import type { Api } from '../telegram/api.ts'
import type { BotInfo, Message } from '../telegram/types.ts'

const COUNT_TTL_MS = 10 * 60_000
/** The owner and the bot. */
const ALONE = 2

/**
 * Which of the owner's messages are for Claude. In a group with other people, only a reply to the bot
 * or a mention of it, so talking to them does not start turns; alone with the bot, every message.
 */
export class Audience {
  private readonly counts = new Map<number, { count: number; at: number }>()
  private readonly api: Api
  private readonly bot: BotInfo
  private readonly now: () => number

  constructor(api: Api, bot: BotInfo, now: () => number) {
    this.api = api
    this.bot = bot
    this.now = now
  }

  /** One message, or a whole album: an album counts when any of its parts is addressed. */
  async isForBot(messages: Message[]): Promise<boolean> {
    const chat = messages[0].chat
    if (chat.type === 'private' || messages.some(m => this.isAddressed(m))) return true
    return (await this.memberCount(chat.id)) <= ALONE
  }

  /** Someone joined or left: count again next time. */
  forget(chatId: number): void {
    this.counts.delete(chatId)
  }

  private isAddressed(message: Message): boolean {
    const replied = message.reply_to_message
    // In a forum every message replies to its topic's opening message, which the bot posted if it created the topic.
    if (replied?.from?.id === this.bot.id && !replied.forum_topic_created) return true
    const text = message.text ?? message.caption ?? ''
    const handle = `@${this.bot.username}`.toLowerCase()
    return (message.entities ?? message.caption_entities ?? []).some(
      e => (e.type === 'mention' && text.slice(e.offset, e.offset + e.length).toLowerCase() === handle) || (e.type === 'text_mention' && e.user?.id === this.bot.id),
    )
  }

  /** Unknown when Telegram refuses; then only addressed messages count. */
  private async memberCount(chatId: number): Promise<number> {
    const cached = this.counts.get(chatId)
    if (cached && this.now() - cached.at < COUNT_TTL_MS) return cached.count
    const count = await this.api.call<number>('getChatMemberCount', { chat_id: chatId }).catch(() => Infinity)
    this.counts.set(chatId, { count, at: this.now() })
    return count
  }
}
