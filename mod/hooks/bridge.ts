import type { Io } from './io.ts'
import { callDaemon, DaemonError, explain } from './client.ts'
import { toPrompt, type BindArgs } from './format.ts'
import type { BindingView, InboundMessage, InboxItem, Stage } from './protocol.ts'

type Pending = { chatId: number; messageIds: number[] }

/** This session's link to Telegram. One per loaded mod; rebuilt from the daemon on every (re)load. */
export type Bridge = {
  sessionId?: string
  binding?: BindingView
  pending: Pending[]
  current?: Pending
  runningTurnId?: string
  notices: Set<string>
  isPolling: boolean
}

const INBOX_WAIT_SECONDS = 20

export function createBridge(): Bridge {
  return { pending: [], notices: new Set(), isPolling: false }
}

export async function attach(io: Io, bridge: Bridge): Promise<void> {
  const sessionId = await io.sessionId()
  const previousSessionId = bridge.sessionId && bridge.sessionId !== sessionId ? bridge.sessionId : undefined
  const { binding } = await callDaemon<{ binding: BindingView | null }>(io, 'POST', '/attach', { sessionId, previousSessionId })
  bridge.sessionId = sessionId
  bridge.binding = binding ?? undefined
  showStatus(io, bridge)
}

export async function bindSession(io: Io, bridge: Bridge, args: BindArgs): Promise<string> {
  const sessionId = await io.sessionId()
  const { binding } = await callDaemon<{ binding: BindingView }>(io, 'POST', '/bind', { sessionId, ...args })
  bridge.sessionId = sessionId
  bridge.binding = binding
  showStatus(io, bridge)
  return `Bound to Telegram: ${binding.title}. Messages there now arrive here; answers are mirrored back.`
}

export async function unbindSession(io: Io, bridge: Bridge): Promise<string> {
  if (!bridge.binding) return 'This session is not bound to Telegram.'
  await callDaemon(io, 'POST', '/unbind', { sessionId: bridge.sessionId })
  const title = bridge.binding.title
  bridge.binding = undefined
  showStatus(io, bridge)
  return `Unbound from ${title}.`
}

/** One long-poll of the inbox; doubles as the heartbeat that keeps the binding live. */
export async function pollOnce(io: Io, bridge: Bridge): Promise<void> {
  if (bridge.isPolling || !bridge.binding) return
  bridge.isPolling = true
  try {
    if ((await io.sessionId()) !== bridge.sessionId) await attach(io, bridge)
    const query = `sessionId=${encodeURIComponent(bridge.sessionId ?? '')}&wait=${INBOX_WAIT_SECONDS}`
    const { items, binding } = await callDaemon<{ items: InboxItem[]; binding: BindingView | null }>(io, 'GET', `/inbox?${query}`)
    bridge.binding = binding ?? undefined
    showStatus(io, bridge)
    for (const item of items) await handle(io, bridge, item)
  } catch (error) {
    showStatus(io, bridge, error)
  } finally {
    bridge.isPolling = false
  }
}

export async function setStage(io: Io, bridge: Bridge, pending: Pending, stage: Stage): Promise<void> {
  await callDaemon(io, 'POST', '/status', { sessionId: bridge.sessionId, ...pending, stage }).catch(() => undefined)
}

export async function mirror(io: Io, bridge: Bridge, text: string): Promise<void> {
  if (!bridge.binding || !text.trim()) return
  await callDaemon(io, 'POST', '/send', { sessionId: bridge.sessionId, text }).catch(error => io.toast(`barista: ${explain(error)}`))
}

export function showStatus(io: Io, bridge: Bridge, problem?: unknown): void {
  if (problem) return void io.status(`TG ⚠ ${problem instanceof DaemonError ? problem.code : 'error'}`)
  io.status(bridge.binding ? `TG: ${bridge.binding.title} ✓` : undefined)
}

async function handle(io: Io, bridge: Bridge, item: InboxItem): Promise<void> {
  if (item.kind === 'stop') return stopTurn(io, bridge)
  await deliver(io, bridge, item)
}

async function deliver(io: Io, bridge: Bridge, message: InboundMessage): Promise<void> {
  const pending = { chatId: message.chatId, messageIds: message.messageIds }
  bridge.pending.push(pending)
  await setStage(io, bridge, pending, 'queued')
  void io.submit(toPrompt(message)).then(
    ({ isDropped }) => {
      bridge.pending = bridge.pending.filter(p => p !== pending)
      if (isDropped) return void setStage(io, bridge, pending, 'failed')
      bridge.current = pending
      return setStage(io, bridge, pending, 'working')
    },
    () => setStage(io, bridge, pending, 'failed'),
  )
}

async function stopTurn(io: Io, bridge: Bridge): Promise<void> {
  if (bridge.runningTurnId) await io.abortTurn(bridge.runningTurnId).catch(() => undefined)
}
