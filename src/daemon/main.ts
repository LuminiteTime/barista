import { mkdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import { loadConfig } from './config.ts'
import { createCore, snapshot, type Core } from './core.ts'
import { createDelivery } from './delivery.ts'
import { log } from './log.ts'
import { paths as defaultPaths, type Paths } from './paths.ts'
import { routesFor } from './routes.ts'
import { serve } from './server.ts'
import { clearNotices, learnChat, sweep } from './sessions.ts'
import { createSaver, loadState } from './state.ts'
import { StatusTracker } from './status.ts'
import { createApi } from './telegram/api.ts'
import { isPollerConflict, runPoller } from './telegram/poller.ts'
import type { BotInfo } from './telegram/types.ts'

const SWEEP_EVERY_MS = 30_000

export type RunningDaemon = { core: Core; server: Server; stop: () => Promise<void> }

/** Wires the daemon together and starts polling Telegram and serving the socket. */
export async function startDaemon(paths: Paths = defaultPaths()): Promise<RunningDaemon> {
  await mkdir(paths.files, { recursive: true, mode: 0o700 })
  const config = await loadConfig(paths.config)
  const api = createApi({ token: config.token, base: config.apiBase })
  const bot = await api.call<BotInfo>('getMe')
  const status = new StatusTracker(api, undefined, error => log('debug', 'status update failed', error))
  const core = createCore({ api, config, paths, bot, status, state: await loadState(paths.state) })
  const saver = createSaver(paths.state, () => snapshot(core))
  core.persist = saver.schedule
  for (const chatId of config.chats ?? []) await learnChat(core, chatId).catch(error => log('warn', `cannot see chat ${chatId}`, error))
  await clearNotices(core)
  const server = await serve(paths.socket, routesFor(core))
  const controller = new AbortController()
  const polling = runPoller({
    api,
    offset: core.offset,
    signal: controller.signal,
    onUpdates: createDelivery(core),
    onOffset: offset => ((core.offset = offset), core.persist()),
    onError: reportPollError,
  })
  const sweeping = setInterval(() => void sweep(core).catch(error => log('warn', 'sweep failed', error)), SWEEP_EVERY_MS)
  log('info', `barista daemon up as @${bot.username}, socket ${paths.socket}`)
  const stop = async () => {
    clearInterval(sweeping)
    controller.abort()
    status.stopAll()
    await new Promise(resolve => server.close(resolve))
    await polling
    await saver.flush()
  }
  return { core, server, stop }
}

function reportPollError(error: unknown): void {
  if (isPollerConflict(error)) {
    log('warn', 'Another poller holds this bot token (409). Normal for up to a minute after a restart; if it persists, stop the other bot client.')
  }
  else log('warn', 'polling failed, retrying', error)
}

/** Foreground entry used by launchd (`barista daemon`). */
export async function runDaemon(): Promise<void> {
  const daemon = await startDaemon().catch(error => {
    log('error', 'daemon failed to start', error)
    process.exit(1)
  })
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void daemon.stop().then(() => process.exit(0)))
  }
}
