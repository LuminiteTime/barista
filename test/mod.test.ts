import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { attach, bindSession, createBridge, endSession, finishTurn, mirror, pollOnce, startTurn } from '../mod/hooks/bridge.ts'
import { parseBindArgs, toPrompt } from '../mod/hooks/format.ts'
import type { HttpInit } from '../mod/hooks/io.ts'
import { closePermissionNotice, closePermissionNotices, openPermissionNotice, trackCall } from '../mod/hooks/permissions.ts'
import { startDaemon } from '../src/daemon/main.ts'
import { paths } from '../src/daemon/paths.ts'
import type { Update } from '../src/daemon/telegram/types.ts'
import { fakeTelegram } from './fake-telegram.ts'
import { boundSession, fakeIo, socketFetch, topicMessage } from './mod-harness.ts'

test('prompt format and bind argument parsing', () => {
  assert.deepEqual(parseBindArgs('Мастерская / Test topic 1 --create'), { chat: 'Мастерская', topic: 'Test topic 1', create: true, force: false })
  assert.deepEqual(parseBindArgs('me'), { chat: 'me', create: false, force: false })
  assert.equal(parseBindArgs('--force'), undefined)
  const prompt = toPrompt({ kind: 'message', chatId: 1, messageIds: [1], header: '[Telegram · X]', text: 'hi', replyTo: 'q', files: ['/f.png'] })
  assert.equal(prompt, '[Telegram · X]\nhi\n↪ in reply to: "q"\n📎 /f.png')
})

test('the mod binds, delivers with reactions, mirrors answers and cleans notices', async () => {
  const queue: Update[][] = [[topicMessage(1, 'learn')]]
  const tg = await fakeTelegram({
    getMe: () => ({ id: 9, first_name: 'B', username: 'b' }),
    getUpdates: async () => queue.shift() ?? (await sleep(20), []),
    sendRichMessage: () => ({ message_id: 100 }),
    sendMessage: () => ({ message_id: 200 }),
  })
  const home = await mkdtemp(join(tmpdir(), 'barista-mod-'))
  await writeFile(join(home, 'config.json'), JSON.stringify({ token: 'T', ownerId: 1, apiBase: tg.base }))
  const daemon = await startDaemon(paths(home))
  await sleep(100)
  const submitted: string[] = []
  const io = fakeIo(home, submitted)
  const bridge = createBridge()

  await attach(io, bridge)
  assert.equal(bridge.binding, undefined)
  assert.match(await bindSession(io, bridge, { chat: 'мастерская', topic: 'Test topic 1', create: false, force: false }), /Bound/)

  queue.push([topicMessage(2, 'привет')])
  await pollOnce(io, bridge)
  await sleep(20)
  assert.equal(submitted[0], '[Telegram · Мастерская / Test topic 1]\nпривет')
  const emojis = tg.named('setMessageReaction').map(c => (c.params.reaction as { emoji: string }[])[0].emoji)
  assert.deepEqual(emojis, ['👀'])

  await mirror(io, bridge, 'готово')
  assert.equal((tg.named('sendRichMessage')[0].params.rich_message as { markdown: string }).markdown, 'готово')

  await openPermissionNotice(io, bridge, 'Bash', { command: 'rm -rf build' })
  assert.match(String(tg.named('sendMessage')[0].params.text), /Bash: rm -rf build/)
  await closePermissionNotices(io, bridge, true)
  assert.equal(tg.named('deleteMessage')[0].params.message_id, 200)

  await daemon.stop()
  await tg.close()
})

test('queued prompts keep 👀 until their own turn starts, and each gets its own 👌', async t => {
  const { queue, io, bridge, submitted, reactions } = await boundSession(t)
  queue.push([topicMessage(2, 'first'), topicMessage(3, 'second')])
  await sleep(1300)
  await pollOnce(io, bridge)
  await sleep(20)
  assert.equal(submitted.length, 2)
  assert.deepEqual(reactions(), ['2👀', '3👀'])
  await startTurn(io, bridge, 't1', submitted[0])
  await finishTurn(io, bridge, 'answer', 'one')
  assert.deepEqual(reactions(), ['2👀', '3👀', '2✍', '2👌'])
  await startTurn(io, bridge, 't2', submitted[1])
  await finishTurn(io, bridge, 'answer', 'two')
  assert.deepEqual(reactions().slice(4), ['3✍', '3👌'])
})

test('a terminal turn does not take a queued Telegram message', async t => {
  const { queue, io, bridge, submitted, reactions } = await boundSession(t)
  queue.push([topicMessage(2, 'later')])
  await sleep(1300)
  await pollOnce(io, bridge)
  await sleep(20)
  await startTurn(io, bridge, 't1', 'typed in the terminal')
  await finishTurn(io, bridge, 'answer', 'terminal answer')
  assert.deepEqual(reactions(), ['2👀'])
  assert.equal(bridge.pending[0].prompt, submitted[0])
})

test('a session that started while the daemon was down attaches on a later poll', async t => {
  const { queue, io: other } = await boundSession(t)
  const bridge = createBridge()
  let isDown = true
  const io = { ...other, fetch: (url: string, init: HttpInit) => (isDown ? Promise.reject(new Error('ECONNREFUSED')) : socketFetch(url, init)) }
  await attach(io, bridge).catch(() => undefined)
  assert.equal(bridge.binding as unknown, undefined)
  isDown = false
  queue.push([topicMessage(2, 'wake the long poll')])
  await pollOnce(io, bridge)
  assert.equal(bridge.binding?.title, 'Мастерская / Test topic 1')
})

test('the final answer survives a short daemon outage', async t => {
  const { tg, io: base, bridge } = await boundSession(t)
  let failures = 2
  const io = { ...base, fetch: (url: string, init: HttpInit) => (failures-- > 0 ? Promise.reject(new Error('ECONNREFUSED')) : socketFetch(url, init)) }
  await mirror(io, bridge, 'still here')
  assert.equal((tg.named('sendRichMessage')[0].params.rich_message as { markdown: string }).markdown, 'still here')
})

test('a notice belongs to its tool call: another call finishing leaves it, its own call removes it', async t => {
  const { tg, io, bridge } = await boundSession(t)
  trackCall(bridge, 'call-bash', 'Bash')
  trackCall(bridge, 'call-read', 'Read')
  await openPermissionNotice(io, bridge, 'Bash', { command: 'make' })
  await closePermissionNotice(io, bridge, 'call-read')
  assert.equal(tg.named('deleteMessage').length, 0)
  await closePermissionNotice(io, bridge, 'call-bash')
  assert.equal(tg.named('deleteMessage').length, 1)
})

test('a notice closed while it is still being posted is deleted, not orphaned', async t => {
  const { tg, io, bridge } = await boundSession(t)
  trackCall(bridge, 'call-1', 'Bash')
  const opening = openPermissionNotice(io, bridge, 'Bash', { command: 'make' })
  await closePermissionNotice(io, bridge, 'call-1')
  await opening
  assert.equal(tg.named('deleteMessage').length, 1)
})

test('ending the session marks running and queued messages 🙈 and never restarts typing', async t => {
  const { queue, io, bridge, submitted, reactions } = await boundSession(t)
  queue.push([topicMessage(2, 'a'), topicMessage(3, 'b')])
  await sleep(1300)
  await pollOnce(io, bridge)
  await sleep(20)
  await startTurn(io, bridge, 't1', submitted[0])
  trackCall(bridge, 'call-1', 'Bash')
  await openPermissionNotice(io, bridge, 'Bash', { command: 'make' })
  await endSession(io, bridge)
  const tail = reactions().slice(-2).sort()
  assert.deepEqual(tail, ['2🙈', '3🙈'])
  assert.ok(!reactions().slice(-3).some(r => r.endsWith('✍')))
})

