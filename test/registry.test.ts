import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Registry } from '../src/daemon/registry.ts'
import type { Message } from '../src/daemon/telegram/types.ts'

const FORUM = { id: -100, type: 'supergroup', title: 'Мастерская', is_forum: true } as const
const GROUP = { id: -200, type: 'group', title: 'Plain' } as const

function msg(extra: Partial<Message>): Message {
  return { message_id: 1, date: 0, chat: FORUM, ...extra }
}

test('learns a topic name from a message inside the topic', () => {
  const registry = new Registry()
  registry.observe({
    update_id: 1,
    message: msg({
      message_thread_id: 7,
      is_topic_message: true,
      reply_to_message: msg({ message_id: 7, forum_topic_created: { name: 'Test topic 1' } }),
    }),
  })
  const target = registry.resolve('мастерская', 'test TOPIC 1')
  assert.deepEqual(target, { chatId: -100, threadId: 7, title: 'Мастерская / Test topic 1' })
})

test('forum chat without a topic is TOPIC_REQUIRED and lists topics', () => {
  const registry = new Registry()
  registry.observe({ update_id: 1, message: msg({ message_thread_id: 3, forum_topic_created: { name: 'A' } }) })
  assert.throws(() => registry.resolve('Мастерская'), (e: Error & { code?: string }) => {
    return e.code === 'TOPIC_REQUIRED' && e.message.includes('A')
  })
})

test('General topic resolves without a thread id', () => {
  const registry = new Registry()
  registry.observe({ update_id: 1, message: msg({}) })
  assert.deepEqual(registry.resolve('Мастерская', 'general'), {
    chatId: -100,
    title: 'Мастерская / General',
  })
})

test('unknown names and topics on plain chats are explicit errors', () => {
  const registry = new Registry()
  registry.observe({ update_id: 1, message: msg({ chat: GROUP }) })
  assert.throws(() => registry.resolve('Nope'), { code: 'CHAT_UNKNOWN' })
  assert.throws(() => registry.resolve('Plain', 'x'), { code: 'NOT_FORUM' })
  assert.throws(() => registry.resolve('Мастерская', 'x'), { code: 'CHAT_UNKNOWN' })
  assert.deepEqual(registry.resolve('Plain'), { chatId: -200, title: 'Plain' })
})

test('private chat resolves as me', () => {
  const registry = new Registry()
  const dm = { id: 42, type: 'private', first_name: 'Mikhail' } as const
  registry.observe({ update_id: 1, message: msg({ chat: dm }) })
  assert.deepEqual(registry.resolve('me'), { chatId: 42, title: 'Mikhail (private)' })
})

test('survives a JSON round trip and forgets chats the bot left', () => {
  const registry = new Registry()
  registry.observe({ update_id: 1, message: msg({ message_thread_id: 3, forum_topic_created: { name: 'A' } }) })
  const restored = Registry.fromJSON(JSON.parse(JSON.stringify(registry.toJSON())))
  assert.equal(restored.resolve('Мастерская', 'A').threadId, 3)
  restored.observe({
    update_id: 2,
    my_chat_member: { chat: FORUM, from: { id: 1, first_name: 'x' }, new_chat_member: { status: 'left' } },
  })
  assert.throws(() => restored.resolve('Мастерская', 'A'), { code: 'CHAT_UNKNOWN' })
})
