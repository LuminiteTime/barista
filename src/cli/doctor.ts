import { access } from 'node:fs/promises'
import type { Health } from '../../mod/hooks/protocol.ts'
import { loadConfig } from '../daemon/config.ts'
import type { Paths } from '../daemon/paths.ts'
import { PLIST } from './launchd.ts'
import { run } from './shell.ts'
import { callDaemon } from './socket.ts'
import { fail, note, ok } from './ui.ts'
import { voiceStatus } from './voice.ts'

type Check = { name: string; ok: boolean; hint?: string }

/** Every precondition, each with what to do when it fails. Exit code 1 if any fails. */
export async function doctor(paths: Paths): Promise<boolean> {
  const checks = [
    await configCheck(paths),
    await exists('launchd agent', PLIST, 'Run: barista setup'),
    ...(await daemonChecks(paths)),
    ...(await voiceChecks(paths)),
    ...(await pluginChecks()),
  ]
  for (const check of checks) report(check)
  return checks.every(c => c.ok)
}

function report({ name, ok: isOk, hint }: Check): void {
  if (isOk) return ok(name)
  fail(name)
  if (hint) note(`  → ${hint}`)
}

async function configCheck(paths: Paths): Promise<Check> {
  const config = await loadConfig(paths.config).catch(() => undefined)
  return { name: 'config (token + owner)', ok: Boolean(config), hint: 'Run: barista setup' }
}

async function daemonChecks(paths: Paths): Promise<Check[]> {
  const reply = await callDaemon(paths.socket, 'GET', '/health').catch(() => undefined)
  if (!reply) return [{ name: 'daemon reachable', ok: false, hint: 'Run: barista start   (then: barista logs)' }]
  const health = reply.body as Health
  return [
    { name: `daemon reachable (v${health.version}, @${health.bot})`, ok: true },
    {
      name: 'privacy mode off (bot reads all group messages)',
      ok: health.canReadGroups,
      hint: 'Fine if the bot is an admin in every bound group; otherwise @BotFather → /setprivacy → Disable',
    },
  ]
}

async function voiceChecks(paths: Paths): Promise<Check[]> {
  const voice = await voiceStatus(paths)
  return [
    { name: 'ffmpeg', ok: voice.ffmpeg, hint: 'brew install ffmpeg' },
    { name: 'whisper-cpp', ok: voice.whisper, hint: 'brew install whisper-cpp' },
    { name: 'whisper model', ok: voice.model, hint: 'barista setup (offers the download)' },
  ]
}

async function pluginChecks(): Promise<Check[]> {
  const list = await run('claude', ['plugin', 'list']).catch(() => '')
  const rival = enabledTelegramPlugin(list)
  return [
    { name: 'Claude Code mod installed', ok: list.includes('barista@'), hint: 'Run: barista setup' },
    { name: 'official Telegram plugin off (one bot token, one poller)', ok: !rival, hint: `claude plugin disable ${rival}` },
  ]
}

/** The official Telegram plugin, if enabled: its sessions poll the same token and starve the daemon (409). */
export function enabledTelegramPlugin(pluginList: string): string | undefined {
  return pluginList.match(/❯ (telegram@\S+)\n(?:(?!\s*❯).*\n)*?\s*Status: ✔ enabled/)?.[1]
}

async function exists(name: string, path: string, hint: string): Promise<Check> {
  return { name, ok: await access(path).then(() => true, () => false), hint }
}
