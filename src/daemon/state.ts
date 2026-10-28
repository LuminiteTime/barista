import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Binding } from './bindings.ts'
import { log } from './log.ts'
import type { ChatEntry } from './registry.ts'

export type NoticeRecord = { key: string; sessionId: string; chatId: number; messageId: number }
export type StateFile = { offset: number; registry: ChatEntry[]; bindings: Binding[]; notices: NoticeRecord[] }

const EMPTY: StateFile = { offset: 0, registry: [], bindings: [], notices: [] }
const SAVE_DEBOUNCE_MS = 500

export async function loadState(path: string): Promise<StateFile> {
  const raw = await readFile(path, 'utf8').catch(() => undefined)
  if (!raw) return structuredClone(EMPTY)
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<StateFile>) }
  } catch {
    const aside = `${path}.corrupt-${Date.now()}`
    await rename(path, aside)
    log('warn', `state was unreadable, moved to ${aside}; starting fresh (bindings and known topics are lost)`)
    return structuredClone(EMPTY)
  }
}

/** Writes state atomically (tmp + rename), coalescing bursts of changes. */
export function createSaver(path: string, snapshot: () => StateFile) {
  let timer: NodeJS.Timeout | undefined
  let writing = Promise.resolve()
  const write = async () => {
    await writeFile(`${path}.tmp`, JSON.stringify(snapshot()), { mode: 0o600 })
    await rename(`${path}.tmp`, path)
  }
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    writing = writing.then(write, write)
    return writing
  }
  return {
    schedule: () => {
      timer ??= setTimeout(() => void flush().catch(error => log('error', 'cannot save state', error)), SAVE_DEBOUNCE_MS)
    },
    flush,
  }
}
