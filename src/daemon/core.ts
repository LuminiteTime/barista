import { Bindings, type Binding } from './bindings.ts'
import type { Config } from './config.ts'
import { BaristaError } from './errors.ts'
import { Inbox } from './inbox.ts'
import type { Paths } from './paths.ts'
import { Registry } from './registry.ts'
import type { NoticeRecord, StateFile } from './state.ts'
import { StatusTracker } from './status.ts'
import type { Api } from './telegram/api.ts'
import type { BotInfo } from './telegram/types.ts'

/** Everything the daemon's use cases share. Built once in main, passed explicitly. */
export type Core = {
  api: Api
  config: Config
  paths: Paths
  bot: BotInfo
  registry: Registry
  bindings: Bindings
  inboxes: Map<string, Inbox>
  notices: Map<string, NoticeRecord>
  status: StatusTracker
  offset: number
  startedAt: number
  persist: () => void
  now: () => number
}

type CoreArgs = Pick<Core, 'api' | 'config' | 'paths' | 'bot' | 'status'> & { state: StateFile; now?: () => number }

export function createCore({ state, now = Date.now, ...rest }: CoreArgs): Core {
  return {
    ...rest,
    registry: Registry.fromJSON(state.registry),
    bindings: Bindings.fromJSON(state.bindings),
    inboxes: new Map(),
    notices: new Map(state.notices.map(n => [n.key, n])),
    offset: state.offset,
    startedAt: now(),
    persist: () => {},
    now,
  }
}

export function snapshot(core: Core): StateFile {
  return {
    offset: core.offset,
    registry: core.registry.toJSON(),
    bindings: core.bindings.toJSON(),
    notices: [...core.notices.values()],
  }
}

export function inboxOf(core: Core, sessionId: string): Inbox {
  let inbox = core.inboxes.get(sessionId)
  if (!inbox) core.inboxes.set(sessionId, (inbox = new Inbox()))
  return inbox
}

export function requireBinding(core: Core, sessionId: string): Binding {
  const binding = core.bindings.get(sessionId)
  if (binding) return binding
  throw new BaristaError('NOT_BOUND', 'This session is not bound to Telegram.', 'Bind it first: /tg bind <chat> / <topic>')
}
