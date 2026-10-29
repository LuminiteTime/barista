import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Inbox } from '../src/daemon/inbox.ts'

const STOP = { kind: 'stop' } as const

test('a push wakes every waiting poll, not only the latest', async () => {
  const inbox = new Inbox()
  const started = Date.now()
  const first = inbox.take(2_000)
  const second = inbox.take(2_000)
  inbox.push(STOP)
  const results = await Promise.all([first, second])
  assert.ok(Date.now() - started < 500, 'both polls returned at once')
  assert.deepEqual(results.flat(), [STOP])
})

test('an aborted poll leaves its items for the next one', async () => {
  const inbox = new Inbox()
  const controller = new AbortController()
  const taking = inbox.take(2_000, controller.signal)
  controller.abort()
  inbox.push(STOP)
  assert.deepEqual(await taking, [])
  assert.deepEqual(await inbox.take(0), [STOP])
})

test('a poll whose client is already gone returns at once', async () => {
  const inbox = new Inbox()
  const started = Date.now()
  assert.deepEqual(await inbox.take(2_000, AbortSignal.abort()), [])
  assert.ok(Date.now() - started < 500)
})
