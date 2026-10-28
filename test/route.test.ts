import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Bindings } from '../src/daemon/bindings.ts'
import { routeUpdate, type RouteContext } from '../src/daemon/inbound/route.ts'
import type { Message } from '../src/daemon/telegram/types.ts'

const OWNER = { id: 1, first_name: 'Owner' }
const FORUM = { id: -100, type: 'supergroup', title: 'F', is_forum: true } as const

function context(): RouteContext {
  const bindings = new Bindings()
  bindings.bind({ sessionId: 's', target: { chatId: -100, threadId: 7, title: 'F / T' }, now: 0 })
  return { ownerId: 1, bindings, now: 0 }
}

function topicMessage(extra: Partial<Message> = {}): Message {
  return { message_id: 9, date: 0, chat: FORUM, from: OWNER, message_thread_id: 7, is_topic_message: true, text: 'hi', ...extra }
}

test('owner message in a bound topic is delivered', () => {
  const route = routeUpdate({ update_id: 1, message: topicMessage() }, context())
  assert.equal(route.kind, 'deliver')
  assert.equal(route.kind === 'deliver' && route.binding.sessionId, 's')
})

test('strangers, unbound topics and service messages are dropped', () => {
  const ctx = context()
  const stranger = topicMessage({ from: { id: 2, first_name: 'X' } })
  assert.equal(routeUpdate({ update_id: 1, message: stranger }, ctx).kind, 'drop')
  assert.equal(routeUpdate({ update_id: 2, message: topicMessage({ message_thread_id: 8 }) }, ctx).kind, 'drop')
  const service = topicMessage({ text: undefined, forum_topic_created: { name: 'x' } })
  assert.equal(routeUpdate({ update_id: 3, message: service }, ctx).kind, 'drop')
})

test('/stop is a stop request for the bound session', () => {
  const route = routeUpdate({ update_id: 1, message: topicMessage({ text: '/stop@coffee42_bot' }) }, context())
  assert.equal(route.kind, 'stop')
})

test('a sticker is unsupported, so the owner sees 🤷 instead of silence', () => {
  const route = routeUpdate({ update_id: 1, message: topicMessage({ text: undefined, sticker: {} }) }, context())
  assert.equal(route.kind, 'unsupported')
})
