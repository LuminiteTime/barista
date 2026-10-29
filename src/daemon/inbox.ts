import type { InboxItem } from '../../mod/hooks/protocol.ts'

/** A session's mailbox: the daemon pushes, the session's mod long-polls. */
export class Inbox {
  private items: InboxItem[] = []
  /** Every poll waiting right now; a mod reload can briefly leave two. */
  private waiters = new Set<() => void>()

  push(item: InboxItem): void {
    this.items.push(item)
    for (const wake of this.waiters) wake()
  }

  /** Resolves with queued items as soon as there are any, or [] after waitMs. A poll whose client left takes nothing. */
  async take(waitMs: number, signal?: AbortSignal): Promise<InboxItem[]> {
    if (this.items.length === 0 && waitMs > 0) await this.waitForItems(waitMs, signal)
    return signal?.aborted ? [] : this.items.splice(0)
  }

  private waitForItems(waitMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        this.waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, waitMs)
      signal?.addEventListener('abort', done)
      this.waiters.add(done)
      if (signal?.aborted) done()
    })
  }
}
