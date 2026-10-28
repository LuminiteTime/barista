import type { Message } from '../telegram/types.ts'

/** Telegram delivers an album as separate messages sharing media_group_id; this folds them into one. */
export class AlbumCollector {
  private groups = new Map<string, { messages: Message[]; timer: NodeJS.Timeout }>()
  private readonly quietMs: number
  private readonly onGroup: (messages: Message[]) => void

  constructor(quietMs: number, onGroup: (messages: Message[]) => void) {
    this.quietMs = quietMs
    this.onGroup = onGroup
  }

  /** Albums wait for the quiet window; anything else is handed over at once. */
  add(message: Message): void {
    const id = message.media_group_id
    if (!id) return this.onGroup([message])
    const group = this.groups.get(id)
    if (group) clearTimeout(group.timer)
    const messages = [...(group?.messages ?? []), message]
    const timer = setTimeout(() => this.flush(id), this.quietMs)
    this.groups.set(id, { messages, timer })
  }

  private flush(id: string): void {
    const group = this.groups.get(id)
    this.groups.delete(id)
    if (group) this.onGroup(group.messages)
  }
}
