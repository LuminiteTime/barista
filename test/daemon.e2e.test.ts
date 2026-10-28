import assert from 'node:assert/strict'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { callDaemon } from '../src/cli/socket.ts'
import { startDaemon } from '../src/daemon/main.ts'
import { paths } from '../src/daemon/paths.ts'
import { sweep } from '../src/daemon/sessions.ts'
import type { Update } from '../src/daemon/telegram/types.ts'
import { fakeTelegram } from './fake-telegram.ts'

const OWNER = { id: 1, first_name: 'Owner' }
const FORUM = { id: -100, type: 'supergroup', title: 'Мастерская', is_forum: true } as const

function topicMessage(id: number, text: string): Update {
  return {
    update_id: id,
    message: {
      message_id: id, date: 0, chat: FORUM, from: OWNER, message_thread_id: 7, is_topic_message: true, text,
      reply_to_message: { message_id: 7, date: 0, chat: FORUM, forum_topic_created: { name: 'Test topic 1' } },
    },
  }
}

async function setup() {
  const queue: Update[][] = [[topicMessage(1, 'learn the topic')]]
  const tg = await fakeTelegram({
    getMe: () => ({ id: 99, first_name: 'Bot', username: 'test_bot', can_read_all_group_messages: true }),
    getUpdates: async () => queue.shift() ?? (await sleep(20), []),
    sendRichMessage: () => ({ message_id: 500 }),
  })
  const home = await mkdtemp(join(tmpdir(), 'barista-e2e-'))
  await writeFile(join(home, 'config.json'), JSON.stringify({ token: 'T', ownerId: 1, apiBase: tg.base }))
  const p = paths(home)
  const api = (method: string, path: string, body?: unknown) => callDaemon(p.socket, method, path, body)
  return { tg, queue, p, api }
}

test('bind, receive, react, answer, and survive a restart', async () => {
  const { tg, queue, p, api } = await setup()
  let daemon = await startDaemon(p)
  await sleep(100)

  const bound = await api('POST', '/bind', { sessionId: 's1', chat: 'мастерская', topic: 'test topic 1' })
  assert.deepEqual(bound.body, { binding: { chatId: -100, threadId: 7, title: 'Мастерская / Test topic 1' } })

  queue.push([topicMessage(2, 'hello **claude**')])
  const inbox = await api('GET', '/inbox?sessionId=s1&wait=5')
  const [item] = (inbox.body as { items: { text: string; messageIds: number[] }[] }).items
  assert.equal(item.text, 'hello **claude**')
  assert.deepEqual(item.messageIds, [2])

  await api('POST', '/status', { sessionId: 's1', chatId: -100, messageIds: [2], stage: 'working' })
  assert.equal(tg.named('setMessageReaction').length, 1)
  await api('POST', '/send', { sessionId: 's1', text: '## done' })
  assert.equal(tg.named('sendRichMessage')[0].params.message_thread_id, 7)

  await daemon.stop()
  daemon = await startDaemon(p)
  const attached = await api('POST', '/attach', { sessionId: 's1' })
  assert.equal((attached.body as { binding: { threadId: number } }).binding.threadId, 7)
  await daemon.stop()
  await tg.close()
})

test('errors come back as code, message and hint', async () => {
  const { tg, p, api } = await setup()
  const daemon = await startDaemon(p)
  await sleep(100)
  const forumOnly = await api('POST', '/bind', { sessionId: 's1', chat: 'Мастерская' })
  assert.equal(forumOnly.status, 400)
  assert.equal((forumOnly.body as { error: { code: string } }).error.code, 'TOPIC_REQUIRED')
  const unbound = await api('POST', '/send', { sessionId: 'nobody', text: 'x' })
  assert.equal((unbound.body as { error: { code: string; hint: string } }).error.code, 'NOT_BOUND')
  await daemon.stop()
  await tg.close()
})

test('an unseen chat can be bound by id, and allowlisted chats are known at start', async () => {
  const tg = await fakeTelegram({
    getMe: () => ({ id: 99, first_name: 'Bot', username: 'test_bot' }),
    getUpdates: async () => (await sleep(20), []),
    getChat: params => ({ ...FORUM, id: params.chat_id }),
    createForumTopic: params => ({ message_thread_id: 55, name: params.name }),
  })
  const home = await mkdtemp(join(tmpdir(), 'barista-e2e-'))
  await writeFile(join(home, 'config.json'), JSON.stringify({ token: 'T', ownerId: 1, apiBase: tg.base, chats: [-100] }))
  const p = paths(home)
  const daemon = await startDaemon(p)
  const byName = await callDaemon(p.socket, 'POST', '/bind', { sessionId: 's', chat: 'Мастерская', topic: 'e2e', create: true })
  assert.equal((byName.body as { binding: { threadId: number } }).binding.threadId, 55)
  await daemon.stop()
  await tg.close()
})

test('"me" is the owner\'s private chat, never a stranger\'s', async () => {
  const stranger = { id: 555, type: 'private', first_name: 'Stranger' } as const
  const queue: Update[][] = [[{ update_id: 1, message: { message_id: 1, date: 0, chat: stranger, from: { id: 555, first_name: 'S' }, text: 'hi' } }]]
  const tg = await fakeTelegram({
    getMe: () => ({ id: 99, first_name: 'Bot', username: 'test_bot' }),
    getUpdates: async () => queue.shift() ?? (await sleep(20), []),
    getChat: params => ({ id: params.chat_id, type: 'private', first_name: 'Owner' }),
  })
  const home = await mkdtemp(join(tmpdir(), 'barista-e2e-'))
  await writeFile(join(home, 'config.json'), JSON.stringify({ token: 'T', ownerId: 1, apiBase: tg.base }))
  const p = paths(home)
  const daemon = await startDaemon(p)
  await sleep(100)
  const bound = await callDaemon(p.socket, 'POST', '/bind', { sessionId: 's', chat: 'me' })
  assert.equal((bound.body as { binding: { chatId: number } }).binding.chatId, 1)
  await daemon.stop()
  await tg.close()
})

test('binding a chat outside the allowlist is refused', async () => {
  const tg = await fakeTelegram({
    getMe: () => ({ id: 99, first_name: 'Bot', username: 'test_bot' }),
    getUpdates: async () => (await sleep(20), []),
    getChat: params => ({ id: params.chat_id, type: 'group', title: 'Other' }),
  })
  const home = await mkdtemp(join(tmpdir(), 'barista-e2e-'))
  await writeFile(join(home, 'config.json'), JSON.stringify({ token: 'T', ownerId: 1, apiBase: tg.base, chats: [-100] }))
  const p = paths(home)
  const daemon = await startDaemon(p)
  const refused = await callDaemon(p.socket, 'POST', '/bind', { sessionId: 's', chat: '-300' })
  assert.equal((refused.body as { error: { code: string } }).error.code, 'CHAT_UNKNOWN')
  await daemon.stop()
  await tg.close()
})

test('the sweep stops typing and deletes notices of sessions that went silent; a failed delete is retried', async () => {
  const { tg, p, api } = await setup()
  let deleteFails = true
  tg.handlers.deleteMessage = () => (deleteFails ? { error_code: 500, description: 'Internal' } : true)
  tg.handlers.sendMessage = () => ({ message_id: 900 })
  const daemon = await startDaemon(p)
  await sleep(100)
  await api('POST', '/bind', { sessionId: 's', chat: 'Мастерская', topic: 'Test topic 1' })
  await api('POST', '/status', { sessionId: 's', chatId: -100, messageIds: [1], stage: 'working' })
  await api('POST', '/notice', { sessionId: 's', key: 'k', text: '🔐' })
  const later = Date.now() + 120_000
  daemon.core.now = () => later
  await sweep(daemon.core)
  assert.equal(daemon.core.notices.size, 1, 'kept for retry after a failed delete')
  deleteFails = false
  await sweep(daemon.core)
  assert.equal(daemon.core.notices.size, 0)
  const typed = tg.named('sendChatAction').length
  await sleep(50)
  assert.equal(tg.named('sendChatAction').length, typed, 'typing stopped')
  await daemon.stop()
  await tg.close()
})

test('a corrupt state.json is set aside instead of crash-looping', async () => {
  const { tg, p } = await setup()
  await writeFile(p.state, '{"offset": 1, "regis')
  const daemon = await startDaemon(p)
  assert.ok((await readdir(p.home)).some(name => name.startsWith('state.json.corrupt-')))
  await daemon.stop()
  await tg.close()
})
