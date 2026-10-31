import type { Io } from './io.ts'
import type { Bridge } from './bridge.ts'
import type { Scene } from './clawd.ts'
import { callDaemon, DaemonError, explain } from './client.ts'
import { bindTarget } from './format.ts'
import type { Health } from './protocol.ts'

/** What the band above the prompt shows: where this session listens, or why it cannot. */
export type Band = { tone: 'bound' | 'waiting' | 'idle' | 'down'; text: string; hint: string; scene: Scene }

export const BIND_HINT = '/tg bind <chat> / <topic>'

export function bandFor(bridge: Bridge, problem?: unknown): Band {
  return { ...lineFor(bridge, problem), scene: sceneFor(bridge, problem) }
}

function lineFor(bridge: Bridge, problem?: unknown): Omit<Band, 'scene'> {
  if (problem) {
    const code = problem instanceof DaemonError ? problem.code : 'INTERNAL'
    return { tone: 'down', text: code, hint: code === 'DAEMON_DOWN' ? 'run: barista start' : 'run: barista doctor' }
  }
  if (bridge.waiting) return { tone: 'waiting', text: `waiting for a message in ${bindTarget(bridge.waiting.args)}`, hint: `${timeLeft(bridge.waiting.triesLeft)} left · send any message there · /tg unbind cancels` }
  if (bridge.binding) return { tone: 'bound', text: bridge.binding.title, hint: 'answers go to Telegram · /tg unbind' }
  return { tone: 'idle', text: 'not bound', hint: BIND_HINT }
}

/** What Clawd is up to: moves while something is happening, stands still otherwise. */
function sceneFor(bridge: Bridge, problem?: unknown): Scene {
  if (problem) return 'down'
  if (bridge.waiting) return 'peek'
  if (bridge.notices.size > 0) return 'ask'
  if (bridge.runningTurnId) return 'brew'
  if (bridge.moment) return bridge.moment.scene
  return bridge.binding ? 'idle' : 'sleep'
}

/** The answer to `/tg status`: the daemon, the bot, and this session's binding. */
export async function describeStatus(io: Io, bridge: Bridge): Promise<string> {
  const health = await callDaemon<Health>(io, 'GET', '/health').catch((error: unknown) => error)
  if (!isHealth(health)) return `✗ barista daemon unreachable. ${explain(health)}`
  const daemon = `daemon up, bot @${health.bot}`
  if (bridge.waiting) return `⏳ Waiting for a message in ${bindTarget(bridge.waiting.args)} (${daemon}), ${timeLeft(bridge.waiting.triesLeft)} left; send any message there to finish binding.`
  if (!bridge.binding) return `○ Not bound (${daemon}). Bind this session: ${BIND_HINT}`
  const remote = bridge.remoteUrl ? ` Remote Control: ${bridge.remoteUrl}` : ''
  return `● Bound to ${bridge.binding.title} (${daemon}). Messages there arrive here; answers go back.${remote}`
}

/** Seconds as m:ss. */
function timeLeft(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function isHealth(value: unknown): value is Health {
  return typeof value === 'object' && value !== null && 'bot' in value
}
