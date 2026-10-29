import { setTimeout as sleep } from 'node:timers/promises'
import { TelegramError, type Api } from './api.ts'
import type { Update } from './types.ts'

const LONG_POLL_SECONDS = 50
const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const ALLOWED_UPDATES = ['message', 'edited_message', 'my_chat_member', 'callback_query']

type PollerArgs = {
  api: Api
  offset: number
  signal: AbortSignal
  onUpdates: (updates: Update[]) => Promise<void>
  onOffset: (offset: number) => void
  onError?: (error: unknown) => void
}

/** The only getUpdates loop for the token. Long polling keeps idle CPU near zero. */
export async function runPoller({ api, offset, signal, onUpdates, onOffset, onError }: PollerArgs): Promise<void> {
  let backoff = MIN_BACKOFF_MS
  while (!signal.aborted) {
    try {
      const params = { offset, timeout: LONG_POLL_SECONDS, allowed_updates: ALLOWED_UPDATES }
      const updates = await api.call<Update[]>('getUpdates', params, { signal })
      backoff = MIN_BACKOFF_MS
      if (updates.length === 0) continue
      await onUpdates(updates)
      offset = updates[updates.length - 1].update_id + 1
      onOffset(offset)
    } catch (error) {
      if (signal.aborted) return
      onError?.(error)
      await sleep(backoff, undefined, { signal }).catch(() => undefined)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    }
  }
}

export function isPollerConflict(error: unknown): boolean {
  return error instanceof TelegramError && error.status === 409
}
