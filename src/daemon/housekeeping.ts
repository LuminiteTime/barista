import { copyFile, readdir, rm, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import type { Core } from './core.ts'
import { log } from './log.ts'

const DAY_MS = 86_400_000
/** Received files are for the turn that reads them; a week is plenty of slack. */
export const FILES_MAX_AGE_MS = 7 * DAY_MS
/** An offline binding is kept so a resumed session finds it again; after a month nobody resumes. */
export const BINDING_MAX_AGE_MS = 30 * DAY_MS
export const LOG_MAX_BYTES = 5 * 1024 * 1024

/** Keeps ~/.barista from growing forever: old files, long-gone bindings, the log. */
export async function housekeep(core: Core): Promise<void> {
  await pruneFiles(core.paths.files, core.now() - FILES_MAX_AGE_MS)
  dropGoneBindings(core)
  await rotateLog(core.paths.log)
}

async function pruneFiles(dir: string, cutoff: number): Promise<void> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
  for (const entry of entries.filter(e => e.isFile())) {
    const path = join(entry.parentPath, entry.name)
    const info = await stat(path).catch(() => undefined)
    if (info && info.mtimeMs < cutoff) await rm(path, { force: true })
  }
}

function dropGoneBindings(core: Core): void {
  const gone = core.bindings.seenBefore(core.now() - BINDING_MAX_AGE_MS)
  for (const { sessionId, title } of gone) {
    core.bindings.unbind(sessionId)
    core.inboxes.delete(sessionId)
    log('info', `forgot binding of session ${sessionId} to ${title}: not seen for 30 days`)
  }
  if (gone.length) core.persist()
}

/**
 * launchd holds the log open for append, so it cannot be renamed away:
 * copy it to daemon.log.1 and empty it in place (lines written in between are lost).
 */
async function rotateLog(path: string): Promise<void> {
  const info = await stat(path).catch(() => undefined)
  if (!info || info.size <= LOG_MAX_BYTES) return
  await copyFile(path, `${path}.1`)
  await truncate(path, 0)
}
