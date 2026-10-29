import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Audience } from '../src/daemon/inbound/audience.ts'
import type { Api } from '../src/daemon/telegram/api.ts'
import type { Chat, Message } from '../src/daemon/telegram/types.ts'

const BOT = { id: 9, first_name: 'Barista', username: 'coffee42_bot', is_bot: true }
const GROUP: Chat = { id: -100, type: 'supergroup', title: 'Island', is_forum: true }
const OWNER = { id: 1, first_name: 'O' }
const TOPIC_ROOT: Message = { message_id: 3, date: 0, chat: GROUP, from: BOT, forum_topic_created: { name: 'talk' } }

const message = (extra: Partial<Message>): Message => ({ message_id: 10, date: 0, chat: GROUP, from: OWNER, text: 'hi all', ...extra })

function audience(members: number) {
  const asked: number[] = []
  let clock = 0
  const api = { call: async (_method: string, params: { chat_id: number }) => (asked.push(params.chat_id), members) } as unknown as Api
  return { audience: new Audience(api, BOT, () => clock), asked, tick: (ms: number) => (clock += ms) }
}

test('in a group with other people only replies to the bot and mentions of it reach Claude', async () => {
  const { audience: a } = audience(5)
  assert.equal(await a.isForBot([message({})]), false)
  assert.equal(await a.isForBot([message({ reply_to_message: message({ message_id: 4, from: BOT }) })]), true)
  assert.equal(await a.isForBot([message({ text: 'ask @Coffee42_Bot please', entities: [{ type: 'mention', offset: 4, length: 13 }] })]), true)
  assert.equal(await a.isForBot([message({ text: 'ask Barista', entities: [{ type: 'text_mention', offset: 4, length: 7, user: BOT }] })]), true)
  assert.equal(await a.isForBot([message({ text: 'ask @someone', entities: [{ type: 'mention', offset: 4, length: 8 }] })]), false)
})

test('a forum message is not a reply to the bot just because the bot opened its topic', async () => {
  const { audience: a } = audience(5)
  assert.equal(await a.isForBot([message({ is_topic_message: true, message_thread_id: 3, reply_to_message: TOPIC_ROOT })]), false)
})

test('an album counts when its caption mentions the bot', async () => {
  const { audience: a } = audience(5)
  const captioned = message({ text: undefined, caption: '@coffee42_bot look', caption_entities: [{ type: 'mention', offset: 0, length: 13 }] })
  assert.equal(await a.isForBot([message({ text: undefined, message_id: 11 }), captioned]), true)
})

test('alone with the bot, or in a private chat, every message reaches Claude', async () => {
  const { audience: a, asked, tick } = audience(2)
  assert.equal(await a.isForBot([message({})]), true)
  assert.equal(await a.isForBot([message({})]), true)
  assert.deepEqual(asked, [-100], 'the member count is cached')
  tick(11 * 60_000)
  await a.isForBot([message({})])
  a.forget(-100)
  await a.isForBot([message({})])
  assert.equal(asked.length, 3, 'expired and forgotten counts are asked again')
  assert.equal(await audience(5).audience.isForBot([message({ chat: { id: 1, type: 'private', first_name: 'O' } })]), true)
})
