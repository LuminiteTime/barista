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
import { setupVoice } from './voice.ts'

export type SetupOptions = { tokenFile?: string; owner?: number; chats?: number[]; yes: boolean; voice: boolean; mod: boolean }

/** One command from zero to a running daemon and an installed mod. */
export async function setup(paths: Paths, options: SetupOptions): Promise<void> {
  await mkdir(paths.home, { recursive: true, mode: 0o700 })
  await stopService() // the token allows one poller; free it while we talk to Telegram
  const config = await configure(options, await loadConfig(paths.config).catch(() => undefined))
  await saveConfig(paths.config, config.config)
  say(`✓ Config saved to ${paths.config} (owner ${config.config.ownerId})`)
  if (options.voice) await setupVoice(paths, options.yes)
  await installService({ node: process.execPath, script: cliEntry(), home: paths.home, log: paths.log })
  say('✓ Daemon installed as a launchd agent (starts at login, restarts on crash)')
  if (options.mod) await installMod()
  await waitForDaemon(paths)
  say('')
  const isHealthy = await doctor(paths)
  printNextSteps(config.bot, isHealthy)
}

async function configure(options: SetupOptions, existing?: Config): Promise<{ config: Config; bot: BotInfo }> {
  const official = await fromOfficialPlugin()
  const token = await pickToken(options, official, existing)
  const api = createApi({ token })
  const bot = await api.call<BotInfo>('getMe').catch(() => {
    throw new Error('Telegram rejected this token. Copy it again from @BotFather → /mybots → API Token.')
  })
  say(`✓ Bot @${bot.username}`)
  const ownerId = options.owner ?? existing?.ownerId ?? officialOwner(official) ?? (await waitForOwner(api, bot))
  return { config: { ...existing, token, ownerId, chats: options.chats ?? existing?.chats }, bot }
}

async function pickToken(options: SetupOptions, official: Credentials, existing?: Config): Promise<string> {
  if (options.tokenFile) return readTokenFile(options.tokenFile)
  if (existing?.token) return existing.token
  if (official.token) {
    say(`✓ Token taken from the Telegram plugin (${OFFICIAL_PLUGIN_DIR}/.env)`)
    return official.token
  }
  return askSecret('Bot token from @BotFather (input hidden): ')
}

function officialOwner({ ownerId }: Credentials): number | undefined {
  if (ownerId) say(`✓ Owner ${ownerId}, the one user the Telegram plugin allows`)
  return ownerId
}

async function waitForOwner(api: Api, bot: BotInfo): Promise<number> {
  say(`Open Telegram, start a private chat with @${bot.username} and send /start …`)
  let offset = 0
  for (;;) {
    const updates = await api.call<Update[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] })
    offset = updates.length ? updates[updates.length - 1].update_id + 1 : offset
    const start = updates.find(u => u.message?.chat.type === 'private' && u.message.text?.startsWith('/start'))
    if (start?.message?.from) {
      await api.call('getUpdates', { offset, timeout: 0 })
      say(`✓ Owner: ${start.message.from.first_name} (${start.message.from.id})`)
      return start.message.from.id
    }
  }
}

async function installMod(): Promise<void> {
  const root = packageRoot()
  await run('claude', ['plugin', 'marketplace', 'add', root]).catch(() => undefined)
  await run('claude', ['plugin', 'marketplace', 'update', 'barista']).catch(() => undefined)
  await run('claude', ['plugin', 'install', 'barista@barista'])
  say('✓ Claude Code mod installed (barista@barista); restart running sessions to load it')
}

/** launchd starts the daemon asynchronously; give it a few seconds before checking it. */
async function waitForDaemon(paths: Paths): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await callDaemon(paths.socket, 'GET', '/health').then(() => true, () => false)) return
    await sleep(500)
  }
}

function printNextSteps(bot: BotInfo, isHealthy: boolean): void {
  say(isHealthy ? '\nAll set.' : '\nFix the ✗ lines above (or ignore the voice ones), then run: barista doctor')
  say(`  1. Restart open Claude Code sessions so they load the mod.`)
  say(`  2. In a session: /tg bind <chat> / <topic>   (Telegram cannot list topics: if @${bot.username} has not seen one, write in it first)`)
  say('  Forum chats: give the bot the "Manage Topics" admin right, and /tg bind … --create makes a topic for you.')
}
