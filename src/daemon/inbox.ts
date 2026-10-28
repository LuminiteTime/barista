import type { InboxItem } from '../../mod/hooks/protocol.ts'

/** A session's mailbox: the daemon pushes, the session's mod long-polls. */
export class Inbox {
  private items: InboxItem[] = []
  private wake?: () => void

  push(item: InboxItem): void {
    this.items.push(item)
    this.wake?.()
  }

  /** Resolves with queued items as soon as there are any, or [] after waitMs. */
  async take(waitMs: number, signal?: AbortSignal): Promise<InboxItem[]> {
    if (this.items.length === 0 && waitMs > 0) await this.waitForItems(waitMs, signal)
    return this.items.splice(0)
  }

  private waitForItems(waitMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        this.wake = undefined
        resolve()
      }
      const timer = setTimeout(done, waitMs)
      signal?.addEventListener('abort', done)
      this.wake = done
    })
  }
}
