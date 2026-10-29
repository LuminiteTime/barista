import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { createBridge } from '../mod/hooks/bridge.ts'
import { parseBindArgs } from '../mod/hooks/format.ts'
import type { Band } from '../mod/hooks/status.ts'
import { bindOrWait, retryWaitingBind } from '../mod/hooks/waiting.ts'
import { startDaemon } from '../src/daemon/main.ts'
import { paths } from '../src/daemon/paths.ts'
import type { Update } from '../src/daemon/telegram/types.ts'
import { fakeTelegram } from './fake-telegram.ts'
import { fakeIo, topicMessage } from './mod-harness.ts'

const TOPIC = { chat: 'Мастерская', topic: 'Test topic 1', create: false, force: false }

/** A daemon whose bot has seen no chat yet, as right after setup. */
async function freshDaemon(t: TestContext) {
  const queue: Update[][] = []
  const tg = await fakeTelegram({
    getMe: () => ({ id: 9, first_name: 'B', username: 'b' }),
    getUpdates: async () => queue.shift() ?? (await sleep(20), []),
  })
  const home = await mkdtemp(join(tmpdir(), 'barista-wait-'))
  await writeFile(join(home, 'config.json'), JSON.stringify({ token: 'T', ownerId: 1, apiBase: tg.base }))
  const daemon = await startDaemon(paths(home))
  t.after(async () => (await daemon.stop(), await tg.close()))
  const bands: Band[] = []
  const toasts: string[] = []
  const io = { ...fakeIo(home, []), status: (band: Band) => void bands.push(band), toast: (text: string) => void toasts.push(text) }
  return { queue, io, bands, toasts, bridge: createBridge() }
}

test('bind arguments lose the quotes people type around names', () => {
  assert.deepEqual(parseBindArgs('"дружеский чат" / «умные обсуждения»'), { chat: 'дружеский чат', topic: 'умные обсуждения', create: false, force: false })
})

test('binding a chat the bot has not seen waits for a message there, then binds by itself', async t => {
  const { queue, io, bands, toasts, bridge } = await freshDaemon(t)
  const text = await bindOrWait(io, bridge, TOPIC)
  assert.match(text, /^⏳ .*send any message in Мастерская \/ Test topic 1/)
  assert.equal(bands.at(-1)?.tone, 'waiting')

  queue.push([topicMessage(1, 'hello')])
  for (let i = 0; i < 40 && !bridge.binding; i++) await (await sleep(50), retryWaitingBind(io, bridge))
  assert.equal(bridge.binding?.title, 'Мастерская / Test topic 1')
  assert.equal(bridge.waiting, undefined)
  assert.equal(bands.at(-1)?.tone, 'bound')
  assert.match(toasts.at(-1) ?? '', /bound to Мастерская \/ Test topic 1/)
})

test('the band counts the wait down', async t => {
  const { io, bands, bridge } = await freshDaemon(t)
  await bindOrWait(io, bridge, TOPIC)
  assert.match(bands.at(-1)?.hint ?? '', /2:00 left/)
  await retryWaitingBind(io, bridge)
  assert.match(bands.at(-1)?.hint ?? '', /1:59 left/)
})

test('the wait gives up when no message comes', async t => {
  const { io, toasts, bands, bridge } = await freshDaemon(t)
  await bindOrWait(io, bridge, TOPIC)
  bridge.waiting!.triesLeft = 1
  await retryWaitingBind(io, bridge)
  assert.equal(bridge.waiting, undefined)
  assert.equal(bands.at(-1)?.tone, 'idle')
  assert.match(toasts.at(-1) ?? '', /no message arrived/)
})
