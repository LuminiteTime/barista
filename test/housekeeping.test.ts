import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCore } from '../src/daemon/core.ts'
import { BINDING_MAX_AGE_MS, FILES_MAX_AGE_MS, housekeep, LOG_MAX_BYTES } from '../src/daemon/housekeeping.ts'
import { paths } from '../src/daemon/paths.ts'
import type { StatusTracker } from '../src/daemon/status.ts'
import type { Api } from '../src/daemon/telegram/api.ts'

const NOW = Date.UTC(2026, 9, 29)
const binding = (sessionId: string, lastSeen: number) => ({ sessionId, lastSeen, chatId: -100, threadId: 7, title: 't' })

async function coreIn(home: string) {
  const state = { offset: 0, registry: [], notices: [], bindings: [binding('old', NOW - BINDING_MAX_AGE_MS - 1), binding('recent', NOW - 1_000)] }
  const config = { token: 'T', ownerId: 1 }
  return createCore({ api: {} as Api, config, paths: paths(home), bot: { id: 9, first_name: 'B' }, status: {} as StatusTracker, state, now: () => NOW })
}

test('housekeeping drops old received files and long-gone bindings, keeps the rest', async () => {
  const home = await mkdtemp(join(tmpdir(), 'barista-hk-'))
  const core = await coreIn(home)
  const dir = join(core.paths.files, '-100', '7')
  await mkdir(dir, { recursive: true })
  const [old, fresh] = [join(dir, '1-old.png'), join(dir, '2-fresh.png')]
  await writeFile(old, 'x')
  await writeFile(fresh, 'x')
  const past = new Date(NOW - FILES_MAX_AGE_MS - 1)
  await utimes(old, past, past)
  await utimes(fresh, new Date(NOW), new Date(NOW))
  await housekeep(core)
  await assert.rejects(stat(old))
  await stat(fresh)
  assert.deepEqual(core.bindings.toJSON().map(b => b.sessionId), ['recent'])
})

test('a log over the limit is moved to daemon.log.1 and emptied in place', async () => {
  const home = await mkdtemp(join(tmpdir(), 'barista-hk-'))
  const core = await coreIn(home)
  await writeFile(core.paths.log, 'x'.repeat(LOG_MAX_BYTES + 1))
  await housekeep(core)
  assert.equal((await stat(core.paths.log)).size, 0)
  assert.equal((await readFile(`${core.paths.log}.1`, 'utf8')).length, LOG_MAX_BYTES + 1)
})
