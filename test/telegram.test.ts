import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createApi, TelegramError } from '../src/daemon/telegram/api.ts'
import { runPoller } from '../src/daemon/telegram/poller.ts'
import { fakeTelegram } from './fake-telegram.ts'

test('retries once after 429 retry_after, then succeeds', async () => {
  let attempts = 0
  const tg = await fakeTelegram({
    sendMessage: () => (++attempts === 1 ? { error_code: 429, description: 'Too Many Requests', retry_after: 0 } : { message_id: 5 }),
  })
  const api = createApi({ token: 'T', base: tg.base })
  const sent = await api.call<{ message_id: number }>('sendMessage', { chat_id: 1, text: 'hi' })
  assert.equal(sent.message_id, 5)
  assert.equal(tg.named('sendMessage').length, 2)
  await tg.close()
})

test('a Bot API error becomes a TelegramError with its description', async () => {
  const tg = await fakeTelegram({ sendMessage: () => ({ error_code: 400, description: 'Bad Request: chat not found' }) })
  const api = createApi({ token: 'T', base: tg.base })
  await assert.rejects(api.call('sendMessage', {}), (e: unknown) => {
    return e instanceof TelegramError && e.status === 400 && e.message.includes('chat not found')
  })
  await tg.close()
})

test('download saves a file next to its Telegram name', async () => {
  const tg = await fakeTelegram({ getFile: () => ({ file_id: 'f', file_path: 'photos/p.jpg' }) })
  const api = createApi({ token: 'T', base: tg.base })
  const dir = await mkdtemp(join(tmpdir(), 'barista-'))
  const path = await api.download('f', dir)
  assert.equal(path, join(dir, 'p.jpg'))
  assert.equal(await readFile(path, 'utf8'), 'file-bytes')
  await tg.close()
})

test('poller hands updates over and advances the offset', async () => {
  const batches = [[{ update_id: 10 }, { update_id: 11 }], []]
  const tg = await fakeTelegram({ getUpdates: () => batches.shift() ?? [] })
  const api = createApi({ token: 'T', base: tg.base })
  const controller = new AbortController()
  const seen: number[] = []
  const offsets: number[] = []
  await runPoller({
    api,
    offset: 0,
    signal: controller.signal,
    onUpdates: async updates => void seen.push(...updates.map(u => u.update_id)),
    onOffset: offset => {
      offsets.push(offset)
      controller.abort()
    },
  })
  assert.deepEqual(seen, [10, 11])
  assert.deepEqual(offsets, [12])
  assert.equal(tg.named('getUpdates')[0].params.timeout, 50)
  await tg.close()
})
