import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where the official Telegram plugin for Claude Code keeps its bot token and allowlist. */
export const OFFICIAL_PLUGIN_DIR = join(homedir(), '.claude', 'channels', 'telegram')
const TOKEN = /\d{5,}:[\w-]{30,}/

export type Credentials = { token?: string; ownerId?: number }

/** A file holding the token, bare or as an .env line; never a command-line argument, which `ps` and shell history would show. */
export async function readTokenFile(path: string): Promise<string> {
  const token = (await readFile(path, 'utf8')).match(TOKEN)?.[0]
  if (!token) throw new Error(`No bot token in ${path}. Put the token from @BotFather there, alone or as TELEGRAM_BOT_TOKEN=…`)
  return token
}

/** What a user switching from the official plugin already set up: its token, and its owner when exactly one user is allowed. */
export async function fromOfficialPlugin(dir = OFFICIAL_PLUGIN_DIR): Promise<Credentials> {
  const token = await readTokenFile(join(dir, '.env')).catch(() => undefined)
  const access = await readFile(join(dir, 'access.json'), 'utf8').then(JSON.parse, () => ({}))
  const allowed: unknown[] = Array.isArray(access.allowFrom) ? access.allowFrom : []
  const ownerId = allowed.length === 1 ? Number(allowed[0]) : NaN
  return { ...(token && { token }), ...(Number.isSafeInteger(ownerId) && { ownerId }) }
}
