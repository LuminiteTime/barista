import type { Stage } from '../../mod/hooks/protocol.ts'
import { where, type Target } from './outbound.ts'
import type { Api } from './telegram/api.ts'

export type StatusStage = Stage | 'unsupported'

/** The lifecycle of an owner's message, shown as one reaction on it. */
export const REACTION: Record<StatusStage, string> = {
  queued: '👀',
  working: '✍',
  waiting: '🤔',
  done: '👌',
  aborted: '🙈',
  failed: '💔',
  unsupported: '🤷',
}

const TYPING_EVERY_MS = 4_000

/** Moves status reactions and keeps "typing…" alive while Claude works. Cosmetic: failures are reported, never thrown. */
export class StatusTracker {
  private typing = new Map<string, NodeJS.Timeout>()
  private readonly api: Api
  private readonly typingEveryMs: number
  private readonly onError: (error: unknown) => void

  constructor(api: Api, typingEveryMs = TYPING_EVERY_MS, onError: (error: unknown) => void = () => {}) {
    this.api = api
    this.typingEveryMs = typingEveryMs
    this.onError = onError
  }

  async set(target: Target, messageIds: number[], stage: StatusStage): Promise<void> {
    if (stage === 'working') this.startTyping(target)
    else this.stopTyping(target)
    const reaction = [{ type: 'emoji', emoji: REACTION[stage] }]
    await Promise.all(
      messageIds.map(message_id =>
        this.api.call('setMessageReaction', { chat_id: target.chatId, message_id, reaction }).catch(this.onError),
      ),
    )
  }

  stopAll(): void {
    for (const timer of this.typing.values()) clearInterval(timer)
    this.typing.clear()
  }

  private startTyping(target: Target): void {
    this.stopTyping(target)
    const tick = () => void this.api.call('sendChatAction', { ...where(target), action: 'typing' }).catch(this.onError)
    tick()
    this.typing.set(keyOf(target), setInterval(tick, this.typingEveryMs))
  }

  private stopTyping(target: Target): void {
    clearInterval(this.typing.get(keyOf(target)))
    this.typing.delete(keyOf(target))
  }
}

function keyOf(target: Target): string {
  return `${target.chatId}:${target.threadId ?? ''}`
}
