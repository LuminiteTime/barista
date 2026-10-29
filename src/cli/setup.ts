import { mkdir, readFile } from 'node:fs/promises'
import { loadConfig, saveConfig, type Config } from '../daemon/config.ts'
import type { Paths } from '../daemon/paths.ts'
import { createApi, type Api } from '../daemon/telegram/api.ts'
import type { BotInfo, Update } from '../daemon/telegram/types.ts'
import { installService, stopService } from './launchd.ts'
import { cliEntry, packageRoot } from './package.ts'
import { askSecret, say } from './prompt.ts'
import { run } from './shell.ts'
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
  printChecklist(config.bot)
}

async function configure(options: SetupOptions, existing?: Config): Promise<{ config: Config; bot: BotInfo }> {
  const fromFile = options.tokenFile ? await readTokenFile(options.tokenFile) : undefined
  const token = fromFile ?? existing?.token ?? (await askSecret('Bot token from @BotFather (input hidden): '))
  const api = createApi({ token })
  const bot = await api.call<BotInfo>('getMe').catch(() => {
    throw new Error('Telegram rejected this token. Copy it again from @BotFather → /mybots → API Token.')
  })
  say(`✓ Bot @${bot.username}`)
  const ownerId = options.owner ?? existing?.ownerId ?? (await waitForOwner(api, bot))
  return { config: { ...existing, token, ownerId, chats: options.chats ?? existing?.chats }, bot }
}

const TOKEN = /\d{5,}:[\w-]{30,}/

/** A file holding the token, bare or as an .env line; never a command-line argument, which `ps` and shell history would show. */
export async function readTokenFile(path: string): Promise<string> {
  const token = (await readFile(path, 'utf8')).match(TOKEN)?.[0]
  if (!token) throw new Error(`No bot token in ${path}. Put the token from @BotFather there, alone or as TELEGRAM_BOT_TOKEN=…`)
  return token
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

function printChecklist(bot: BotInfo): void {
  say('\nBefore the first bind:')
  if (!bot.can_read_all_group_messages) {
    say(`  • Groups: make @${bot.username} an admin, or disable privacy mode (@BotFather → /setprivacy → Disable)`)
  }
  say('  • Forum chats: give the bot the "Manage Topics" admin right to let it create topics')
  say('  • Remote Control: be logged in to Claude Code with a claude.ai account')
  say('\nThen, in any Claude Code session: /tg bind <chat> / <topic>   ·   check everything: barista doctor')
}
