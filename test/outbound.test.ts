import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { sendFiles, sendText } from '../src/daemon/outbound.ts'
import { StatusTracker } from '../src/daemon/status.ts'
import { createApi } from '../src/daemon/telegram/api.ts'
import { fakeTelegram } from './fake-telegram.ts'

const TARGET = { chatId: -100, threadId: 7 }

test('rich markdown goes to the topic via sendRichMessage', async () => {
  const tg = await fakeTelegram({ sendRichMessage: () => ({ message_id: 1 }) })
  await sendText(createApi({ token: 'T', base: tg.base }), TARGET, '# Done\n**ok**')
  const [call] = tg.named('sendRichMessage')
  assert.deepEqual(call.params, { chat_id: -100, message_thread_id: 7, rich_message: { markdown: '# Done\n**ok**' } })
  await tg.close()
})

test('a markdown parse error falls back to plain text once', async () => {
  const tg = await fakeTelegram({
    sendRichMessage: () => ({ error_code: 400, description: "Bad Request: can't parse" }),
    sendMessage: () => ({ message_id: 2 }),
  })
  const ids = await sendText(createApi({ token: 'T', base: tg.base }), TARGET, 'broken **md')
  assert.deepEqual(ids, [2])
  assert.equal(tg.named('sendMessage')[0].params.text, 'broken **md')
  await tg.close()
})

test('three photos become one album, missing files are an explicit error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'barista-'))
  const photos = ['a.png', 'b.jpg', 'c.jpeg'].map(name => join(dir, name))
  for (const p of photos) await writeFile(p, 'x')
  const tg = await fakeTelegram({ sendMediaGroup: () => [{ message_id: 1 }, { message_id: 2 }, { message_id: 3 }] })
  const api = createApi({ token: 'T', base: tg.base })
  const ids = await sendFiles(api, TARGET, photos.map(path => ({ path })), 'shots')
  assert.equal(tg.named('sendMediaGroup').length, 1)
  assert.equal(tg.named('sendMediaGroup')[0].multipart, true)
  assert.deepEqual(ids, [1, 2, 3])
  await assert.rejects(sendFiles(api, TARGET, [{ path: join(dir, 'nope.txt') }]), { code: 'FILE_NOT_FOUND' })
  await tg.close()
})

test('a single document is sent with sendDocument', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'barista-'))
  const path = join(dir, 'report.pdf')
  await writeFile(path, 'x')
  const tg = await fakeTelegram({ sendDocument: () => ({ message_id: 4 }) })
  assert.deepEqual(await sendFiles(createApi({ token: 'T', base: tg.base }), TARGET, [{ path, caption: 'r' }]), [4])
  await tg.close()
})

test('status reactions move and typing stops when work ends', async () => {
  const tg = await fakeTelegram()
  const status = new StatusTracker(createApi({ token: 'T', base: tg.base }), 20)
  await status.set(TARGET, [5], 'working')
  await sleep(70)
  await status.set(TARGET, [5], 'done')
  const typing = tg.named('sendChatAction').length
  assert.ok(typing >= 2)
  await sleep(70)
  assert.equal(tg.named('sendChatAction').length, typing)
  const emojis = tg.named('setMessageReaction').map(c => (c.params.reaction as { emoji: string }[])[0].emoji)
  assert.deepEqual(emojis, ['✍', '👌'])
  await tg.close()
})
