import type { Io } from './io.ts'
import { callDaemon, DaemonError, explain } from './client.ts'
import { toPrompt, type BindArgs } from './format.ts'
import type { BindingView, InboundMessage, InboxItem, Stage } from './protocol.ts'
import { chooseInTelegram, type Asking } from './questions.ts'
import { bandFor } from './status.ts'

/** A Telegram message handed to Claude Code, waiting for (or running in) a turn. */
export type Pending = { chatId: number; messageIds: number[]; prompt: string }

/** This session's link to Telegram. One per loaded mod; rebuilt from the daemon on every (re)load. */
export type Bridge = {
  sessionId?: string
  binding?: BindingView
  isAttached: boolean
  pending: Pending[]
  current: Pending[]
  runningTurnId?: string
  /** Open permission notices: key → the request posting it. */
  notices: Map<string, Promise<void>>
  /** Tool calls in flight: tool_use_id → tool name. */
  calls: Map<string, string>
  /** Claude's questions open in Telegram, by notice key (see questions.ts). */
  asking: Map<string, Asking>
  /** This session in Remote Control, once it is on. */
  remoteUrl?: string
  /** A bind waiting for the bot to see its chat (see waiting.ts). */
  waiting?: { args: BindArgs; triesLeft: number }
  isPolling: boolean
}

export type TurnEnd = 'answer' | 'aborted' | 'refusal' | 'error'

const INBOX_WAIT_SECONDS = 20
const TELEGRAM_HEADER = '[Telegram · '
const END_STAGE: Record<TurnEnd, Stage> = { answer: 'done', aborted: 'aborted', refusal: 'failed', error: 'failed' }
const MIRROR_RETRIES = 6
const MIRROR_RETRY_MS = 5_000

export function createBridge(): Bridge {
  return { isAttached: false, pending: [], current: [], notices: new Map(), calls: new Map(), asking: new Map(), isPolling: false }
}

export async function attach(io: Io, bridge: Bridge): Promise<void> {
  const sessionId = await io.sessionId()
  const previousSessionId = bridge.sessionId && bridge.sessionId !== sessionId ? bridge.sessionId : undefined
  const { binding } = await callDaemon<{ binding: BindingView | null }>(io, 'POST', '/attach', { sessionId, previousSessionId })
  bridge.sessionId = sessionId
  bridge.binding = binding ?? undefined
  bridge.isAttached = true
  showStatus(io, bridge)
}

export async function bindSession(io: Io, bridge: Bridge, args: BindArgs): Promise<string> {
  const sessionId = await io.sessionId()
  const { binding } = await callDaemon<{ binding: BindingView }>(io, 'POST', '/bind', { sessionId, ...args })
  bridge.sessionId = sessionId
  bridge.binding = binding
  bridge.isAttached = true
  showStatus(io, bridge)
  return `Bound to Telegram: ${binding.title}. Messages there now arrive here; answers are mirrored back.`
}

export async function unbindSession(io: Io, bridge: Bridge): Promise<string> {
  const wasWaiting = bridge.waiting !== undefined
  bridge.waiting = undefined
  showStatus(io, bridge)
  if (!bridge.binding) return wasWaiting ? 'Stopped waiting to bind.' : 'This session is not bound to Telegram.'
  await callDaemon(io, 'POST', '/unbind', { sessionId: bridge.sessionId })
  const title = bridge.binding.title
  bridge.binding = undefined
  showStatus(io, bridge)
  return `Unbound from ${title}.`
}

/** One long-poll of the inbox; doubles as the heartbeat that keeps the binding live and the retry for a failed attach. */
export async function pollOnce(io: Io, bridge: Bridge): Promise<void> {
  if (bridge.isPolling) return
  bridge.isPolling = true
  try {
    if (!bridge.isAttached || (await io.sessionId()) !== bridge.sessionId) await attach(io, bridge)
    if (!bridge.binding) return
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

/** A main-loop turn began: the Telegram messages it carries (none for a terminal prompt) start working. */
export async function startTurn(io: Io, bridge: Bridge, turnId: string, text: string): Promise<void> {
  bridge.runningTurnId = turnId
  let started = bridge.pending.filter(p => text.includes(p.prompt))
  if (started.length === 0 && text.includes(TELEGRAM_HEADER)) started = bridge.pending.slice(0, 1)
  bridge.pending = bridge.pending.filter(p => !started.includes(p))
  bridge.current = started
  await setStages(io, bridge, started, 'working')
}

export async function finishTurn(io: Io, bridge: Bridge, reason: TurnEnd, answer: string): Promise<void> {
  bridge.runningTurnId = undefined
  await setStages(io, bridge, bridge.current, END_STAGE[reason])
  const replyTo = replyTarget(bridge)
  const fallback = reason === 'answer' || reason === 'aborted' ? '' : `💔 The turn ended with ${reason}.`
  bridge.current = []
  await mirror(io, bridge, answer || fallback, replyTo)
}

/** The Telegram message the running turn answers: the latest it carries. None for a terminal prompt. */
export function replyTarget(bridge: Bridge): number | undefined {
  const asked = bridge.current.filter(p => p.chatId === bridge.binding?.chatId).at(-1)
  return asked?.messageIds[0]
}

/** The session is closing: whatever Telegram is still waiting on will not run. */
export async function endSession(io: Io, bridge: Bridge): Promise<void> {
  await setStages(io, bridge, [...bridge.current, ...bridge.pending], 'aborted')
  bridge.current = []
  bridge.pending = []
}

export async function setStages(io: Io, bridge: Bridge, messages: Pending[], stage: Stage): Promise<void> {
  for (const { chatId, messageIds } of messages) {
    await callDaemon(io, 'POST', '/status', { sessionId: bridge.sessionId, chatId, messageIds, stage }).catch(() => undefined)
  }
}

/** Sends the answer, waiting out a short daemon outage (restart, crash loop) rather than losing it. */
export async function mirror(io: Io, bridge: Bridge, text: string, replyTo?: number): Promise<void> {
  if (!bridge.binding || !text.trim()) return
  for (let attempt = 0; ; attempt++) {
    try {
      return void (await callDaemon(io, 'POST', '/send', { sessionId: bridge.sessionId, text, replyTo }))
    } catch (error) {
      const isDown = error instanceof DaemonError && error.code === 'DAEMON_DOWN'
      if (!isDown || attempt >= MIRROR_RETRIES) return io.toast(`barista: ${explain(error)}`)
      await new Promise<void>(resolve => io.after(MIRROR_RETRY_MS, resolve))
    }
  }
}

export function showStatus(io: Io, bridge: Bridge, problem?: unknown): void {
  io.status(bandFor(bridge, problem))
}

async function handle(io: Io, bridge: Bridge, item: InboxItem): Promise<void> {
  if (item.kind === 'stop') return stopTurn(io, bridge)
  if (item.kind === 'choice') return chooseInTelegram(io, bridge, item.key, item.data)
  await deliver(io, bridge, item)
}

/** Queues the message as a prompt; 👀 until its turn starts (see startTurn). */
async function deliver(io: Io, bridge: Bridge, message: InboundMessage): Promise<void> {
  const pending = { chatId: message.chatId, messageIds: message.messageIds, prompt: toPrompt(message) }
  bridge.pending.push(pending)
  await setStages(io, bridge, [pending], 'queued')
  const fail = () => {
    bridge.pending = bridge.pending.filter(p => p !== pending)
    return setStages(io, bridge, [pending], 'failed')
  }
  void io.submit(pending.prompt).then(({ isDropped }) => (isDropped ? fail() : undefined), fail)
}

async function stopTurn(io: Io, bridge: Bridge): Promise<void> {
  if (bridge.runningTurnId) await io.abortTurn(bridge.runningTurnId).catch(() => undefined)
}
