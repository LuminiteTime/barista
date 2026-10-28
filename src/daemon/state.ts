import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Binding } from './bindings.ts'
import type { ChatEntry } from './registry.ts'

export type NoticeRecord = { key: string; sessionId: string; chatId: number; messageId: number }
export type StateFile = { offset: number; registry: ChatEntry[]; bindings: Binding[]; notices: NoticeRecord[] }

const EMPTY: StateFile = { offset: 0, registry: [], bindings: [], notices: [] }
const SAVE_DEBOUNCE_MS = 500

export async function loadState(path: string): Promise<StateFile> {
  const raw = await readFile(path, 'utf8').catch(() => undefined)
  return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<StateFile>) } : structuredClone(EMPTY)
}

/** Writes state atomically (tmp + rename), coalescing bursts of changes. */
export function createSaver(path: string, snapshot: () => StateFile) {
  let timer: NodeJS.Timeout | undefined
  const flush = async () => {
    clearTimeout(timer)
    timer = undefined
    await writeFile(`${path}.tmp`, JSON.stringify(snapshot()), { mode: 0o600 })
    await rename(`${path}.tmp`, path)
  }
  return {
    schedule: () => {
      timer ??= setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
    },
    flush,
  }
}
