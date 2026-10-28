import { chmod, readFile, writeFile } from 'node:fs/promises'
import { BaristaError } from './errors.ts'

export type Config = {
  token: string
  ownerId: number
  /** When set, updates from any other chat are ignored entirely. */
  chats?: number[]
  whisperModel?: string
  apiBase?: string
}

export async function loadConfig(path: string): Promise<Config> {
  const raw = await readFile(path, 'utf8').catch(() => undefined)
  const config = raw ? (JSON.parse(raw) as Partial<Config>) : {}
  if (!config.token || !config.ownerId) {
    throw new BaristaError('NOT_CONFIGURED', `No bot token or owner id in ${path}.`, 'Run: barista setup')
  }
  return config as Config
}

export async function saveConfig(path: string, config: Config): Promise<void> {
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await chmod(path, 0o600)
}
