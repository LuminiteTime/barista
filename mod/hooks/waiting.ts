import type { Io } from './io.ts'
import { bindSession, showStatus, type Bridge } from './bridge.ts'
import { DaemonError } from './client.ts'
import { bindTarget, type BindArgs } from './format.ts'
import { startRemoteControl } from './remote.ts'

/** The poll timer retries once a second, so this is also the seconds left: two minutes. */
const WAIT_TRIES = 120
const UNSEEN = new Set(['CHAT_UNKNOWN', 'TOPIC_UNKNOWN'])

/**
 * Binds now or, when the bot has not seen that chat or topic, waits for a message there and binds then.
 * Telegram cannot list a bot's chats: barista learns one from the first message it sees in it.
 */
export async function bindOrWait(io: Io, bridge: Bridge, args: BindArgs): Promise<string> {
  bridge.waiting = undefined
  try {
    return await bind(io, bridge, args)
  } catch (error) {
    if (!isUnseen(error, args)) throw error
    bridge.waiting = { args, triesLeft: WAIT_TRIES }
    showStatus(io, bridge)
    const target = bindTarget(args)
    return `⏳ The bot has not seen ${target} yet (Telegram does not let bots list their chats). Within 2 minutes, send any message in ${target}: this session binds itself when it arrives.`
  }
}

/** One retry of a waiting bind; the poll timer calls it. */
export async function retryWaitingBind(io: Io, bridge: Bridge): Promise<void> {
  const waiting = bridge.waiting
  if (!waiting) return
  waiting.triesLeft--
  bridge.waiting = undefined // so the band bindSession draws on success is the bound one
  try {
    await bind(io, bridge, waiting.args)
    io.toast(`barista: bound to ${bridge.binding?.title}`)
  } catch (error) {
    const keepsWaiting = isUnseen(error, waiting.args) && waiting.triesLeft > 0
    if (keepsWaiting) bridge.waiting = waiting
    showStatus(io, bridge)
    if (keepsWaiting) return
    io.toast(`barista: no message arrived in ${bindTarget(waiting.args)}; run /tg bind again`)
  }
}

async function bind(io: Io, bridge: Bridge, args: BindArgs): Promise<string> {
  const text = await bindSession(io, bridge, args)
  startRemoteControl(io, bridge)
  return text
}

/** A name the bot may yet see; a numeric id it cannot see is final. */
function isUnseen(error: unknown, args: BindArgs): boolean {
  return error instanceof DaemonError && UNSEEN.has(error.code) && !/^-?\d+$/.test(args.chat)
}
