import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { loadConfig, saveConfig, type Config } from '../daemon/config.ts'
import type { Paths } from '../daemon/paths.ts'
import { createApi, type Api } from '../daemon/telegram/api.ts'
import type { BotInfo, Update } from '../daemon/telegram/types.ts'
import { fromOfficialPlugin, OFFICIAL_PLUGIN_DIR, readTokenFile, type Credentials } from './credentials.ts'
import { doctor } from './doctor.ts'
import { installService, stopService } from './launchd.ts'
import { cliEntry, packageRoot } from './package.ts'
import { askSecret, say } from './prompt.ts'
import { run } from './shell.ts'
import { callDaemon } from './socket.ts'
import { banner, fail, note, ok, paint, spin, step } from './ui.ts'
import { setupVoice } from './voice.ts'

export type SetupOptions = { tokenFile?: string; owner?: number; chats?: number[]; yes: boolean; voice: boolean; mod: boolean }

type Stage = [title: string, work: () => Promise<unknown>]

/** One command from zero to a running daemon and an installed mod, each stage on screen as it runs. */
export async function setup(paths: Paths, options: SetupOptions): Promise<void> {
  banner()
  let bot: BotInfo | undefined
  let isHealthy = false
  const stages: Stage[] = [
    ['Telegram bot', async () => (bot = await connectTelegram(paths, options))],
    ...(options.voice ? [['Voice transcripts', () => setupVoice(paths, options.yes)] as Stage] : []),
    ['Background daemon', () => installDaemon(paths)],
    ...(options.mod ? [['Claude Code mod', installMod] as Stage] : []),
    ['Final check', async () => (isHealthy = await doctor(paths))],
  ]
  for (const [index, [title, work]] of stages.entries()) {
    step(index + 1, stages.length, title)
    await work()
  }
  printNextSteps(bot!, isHealthy)
}

async function connectTelegram(paths: Paths, options: SetupOptions): Promise<BotInfo> {
  await mkdir(paths.home, { recursive: true, mode: 0o700 })
  await stopService() // the token allows one poller; free it while we talk to Telegram
  const { config, bot } = await configure(options, await loadConfig(paths.config).catch(() => undefined))
  await saveConfig(paths.config, config)
  ok(`Config saved to ${paths.config}`)
  return bot
}

async function configure(options: SetupOptions, existing?: Config): Promise<{ config: Config; bot: BotInfo }> {
  const official = await fromOfficialPlugin()
  const token = await pickToken(options, official, existing)
  const api = createApi({ token })
  const bot = await spin('Checking the token with Telegram', api.call<BotInfo>('getMe')).catch(() => {
    throw new Error('Telegram rejected this token. Copy it again from @BotFather → /mybots → API Token.')
  })
  ok(`Bot @${bot.username}`)
  const ownerId = options.owner ?? existing?.ownerId ?? officialOwner(official) ?? (await waitForOwner(api, bot))
  if (options.owner ?? existing?.ownerId) ok(`Owner ${ownerId}`)
  return { config: { ...existing, token, ownerId, chats: options.chats ?? existing?.chats }, bot }
}

async function pickToken(options: SetupOptions, official: Credentials, existing?: Config): Promise<string> {
  if (options.tokenFile) return readTokenFile(options.tokenFile)
  if (existing?.token) return existing.token
  if (official.token) {
    ok(`Token taken from the Telegram plugin (${OFFICIAL_PLUGIN_DIR}/.env)`)
    return official.token
  }
  return askSecret('  Bot token from @BotFather (input hidden): ')
}

function officialOwner({ ownerId }: Credentials): number | undefined {
  if (ownerId) ok(`Owner ${ownerId}, the one user the Telegram plugin allows`)
  return ownerId
}

async function waitForOwner(api: Api, bot: BotInfo): Promise<number> {
  note(`Open Telegram, start a private chat with @${bot.username} and send /start`)
  const owner = await spin(`Waiting for your /start`, firstStart(api))
  ok(`Owner ${owner.first_name} (${owner.id})`)
  return owner.id
}

async function firstStart(api: Api): Promise<{ id: number; first_name: string }> {
  let offset = 0
  for (;;) {
    const updates = await api.call<Update[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] })
    offset = updates.length ? updates[updates.length - 1].update_id + 1 : offset
    const start = updates.find(u => u.message?.chat.type === 'private' && u.message.text?.startsWith('/start'))
    if (start?.message?.from) {
      await api.call('getUpdates', { offset, timeout: 0 })
      return start.message.from
    }
  }
}

async function installDaemon(paths: Paths): Promise<void> {
  await spin('Installing the launchd agent', installService({ node: process.execPath, script: cliEntry(), home: paths.home, log: paths.log }))
  ok('launchd agent dev.barista.daemon (starts at login, restarts on crash)')
  if (await spin('Waiting for the daemon to answer', waitForDaemon(paths))) ok(`Daemon running, log in ${paths.log}`)
  else fail('The daemon did not answer within 10 s; the check below and `barista logs` say why')
}

/** launchd starts the daemon asynchronously; give it a few seconds before checking it. */
async function waitForDaemon(paths: Paths): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await callDaemon(paths.socket, 'GET', '/health').then(() => true, () => false)) return true
    await sleep(500)
  }
  return false
}

async function installMod(): Promise<void> {
  const root = packageRoot()
  await spin('Registering the barista marketplace', run('claude', ['plugin', 'marketplace', 'add', root]).catch(() => undefined))
  await spin('Refreshing the marketplace', run('claude', ['plugin', 'marketplace', 'update', 'barista']).catch(() => undefined))
  await spin('Installing barista@barista', run('claude', ['plugin', 'install', 'barista@barista']))
  ok('Claude Code mod installed (barista@barista)')
}

function printNextSteps(bot: BotInfo, isHealthy: boolean): void {
  const line = paint('gray', '─'.repeat(60))
  say(`\n${line}`)
  say(isHealthy ? paint('green', ' ☕ All set.') : paint('yellow', ' ☕ Almost: fix the ✗ lines above (voice ones are optional), then run barista doctor'))
  say(`\n ${paint('bold', '1.')} Restart open Claude Code sessions so they load the mod.`)
  say(` ${paint('bold', '2.')} In a session: ${paint('cyan', '/tg bind <chat> / <topic>')}`)
  note(` Telegram cannot list topics: if @${bot.username} has not seen one, write in it first.`)
  note(' Forum chats: give the bot "Manage Topics", and /tg bind … --create makes the topic.')
  say(line)
}
