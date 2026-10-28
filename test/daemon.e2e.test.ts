import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { callDaemon } from '../src/cli/socket.ts'
import { startDaemon } from '../src/daemon/main.ts'
import { paths } from '../src/daemon/paths.ts'
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
