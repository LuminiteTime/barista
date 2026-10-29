import type { BindingView } from '../../mod/hooks/protocol.ts'
import { BaristaError } from './errors.ts'

/** A session counts as listening while its mod polled within this window. */
export const LIVE_WINDOW_MS = 60_000

export type Binding = BindingView & { sessionId: string; lastSeen: number }

type BindArgs = { sessionId: string; target: BindingView; now: number; force?: boolean }

/** Which session listens where. One session per chat/topic; offline sessions keep their record for resume. */
export class Bindings {
  private bySession = new Map<string, Binding>()

  static fromJSON(entries: Binding[]): Bindings {
    const bindings = new Bindings()
    for (const entry of entries) bindings.bySession.set(entry.sessionId, entry)
    return bindings
  }

  toJSON(): Binding[] {
    return [...this.bySession.values()]
  }

  get(sessionId: string): Binding | undefined {
    return this.bySession.get(sessionId)
  }

  bind({ sessionId, target, now, force }: BindArgs): Binding {
    const holder = this.holderOf(target.chatId, target.threadId)
    if (holder && holder.sessionId !== sessionId) {
      if (isLive(holder, now) && !force) throw taken(target.title)
      this.bySession.delete(holder.sessionId)
    }
    const binding: Binding = { ...target, sessionId, lastSeen: now }
    this.bySession.set(sessionId, binding)
    return binding
  }

  unbind(sessionId: string): Binding | undefined {
    const binding = this.bySession.get(sessionId)
    this.bySession.delete(sessionId)
    return binding
  }

  touch(sessionId: string, now: number): Binding | undefined {
    const binding = this.bySession.get(sessionId)
    if (binding) binding.lastSeen = now
    return binding
  }

  rename(oldId: string, newId: string): void {
    const binding = this.bySession.get(oldId)
    if (!binding) return
    this.bySession.delete(oldId)
    this.bySession.set(newId, { ...binding, sessionId: newId })
  }

  /** The live session listening on this exact chat/thread, if any. */
  targetFor(chatId: number, threadId: number | undefined, now: number): Binding | undefined {
    const holder = this.holderOf(chatId, threadId)
    return holder && isLive(holder, now) ? holder : undefined
  }

  offline(now: number): Binding[] {
    return this.toJSON().filter(b => !isLive(b, now))
  }

  seenBefore(cutoff: number): Binding[] {
    return this.toJSON().filter(b => b.lastSeen < cutoff)
  }

  private holderOf(chatId: number, threadId: number | undefined): Binding | undefined {
    return this.toJSON().find(b => b.chatId === chatId && b.threadId === threadId)
  }
}

export function isLive(binding: Binding, now: number): boolean {
  return now - binding.lastSeen <= LIVE_WINDOW_MS
}

function taken(title: string): BaristaError {
  return new BaristaError(
    'TOPIC_TAKEN',
    `Another live session already listens on "${title}".`,
    'Unbind it there, or bind here with --force.',
  )
}
