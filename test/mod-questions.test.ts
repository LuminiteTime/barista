import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { pollOnce } from '../mod/hooks/bridge.ts'
import { askPermissionQuestion, closePermissionNotice, trackCall } from '../mod/hooks/permissions.ts'
import type { Update } from '../src/daemon/telegram/types.ts'
import { boundSession } from './mod-harness.ts'

const ONE = {
  questions: [{ question: 'Which database?', header: 'Storage', multiSelect: false, options: [{ label: 'Postgres', description: 'relational' }, { label: 'SQLite' }] }],
}
const MANY = {
  questions: [{ question: 'Which checks?', header: 'CI', multiSelect: true, options: [{ label: 'lint' }, { label: 'tests' }, { label: 'build' }] }],
}

const press = (id: number, messageId: number, data: string, from = 1): Update => ({
  update_id: id,
  callback_query: { id: `cb${id}`, from: { id: from, first_name: 'O' }, data, message: { message_id: messageId, date: 0, chat: { id: -100, type: 'supergroup' } } },
})

type Keyboard = { inline_keyboard: { text: string; callback_data: string }[][] }

test('a question from Claude arrives as text with a button per option, and a tap answers it', async t => {
  const { tg, queue, io, bridge } = await boundSession(t)
  trackCall(bridge, 'call-q', 'AskUserQuestion')
  const answers = askPermissionQuestion(io, bridge, ONE)
  await sleep(100)
  const [posted] = tg.named('sendMessage')
  assert.match(String(posted.params.text), /^❓ Storage: Which database\?\n• Postgres: relational\n\nTap an answer/)
  assert.ok(!String(posted.params.text).includes('{'), 'no JSON')
  const keyboard = posted.params.reply_markup as Keyboard
  assert.deepEqual(keyboard.inline_keyboard.map(row => row[0].text), ['Postgres', 'SQLite'])

  queue.push([press(50, 301, '0:1', 666), press(51, 301, '0:1')])
  await pollOnce(io, bridge)
  assert.deepEqual(await answers, { 'Which database?': 'SQLite' })
  await sleep(50)
  assert.deepEqual(tg.named('answerCallbackQuery').map(c => c.params.text), ['Only the owner of this bot can answer.', ''])

  await closePermissionNotice(io, bridge, 'call-q')
  assert.equal(tg.named('deleteMessage').length, 1, 'the question leaves Telegram when the call ends')
})

test('multi-select toggles in place and answers on Done', async t => {
  const { tg, queue, io, bridge } = await boundSession(t)
  trackCall(bridge, 'call-q', 'AskUserQuestion')
  const answers = askPermissionQuestion(io, bridge, MANY)
  await sleep(100)
  queue.push([press(50, 301, '0:2'), press(51, 301, '0:0')])
  while (tg.named('editMessageText').length < 2) await pollOnce(io, bridge)
  const edited = tg.named('editMessageText').at(-1)?.params.reply_markup as Keyboard
  assert.deepEqual(edited.inline_keyboard.map(row => row[0].text), ['☑ lint', '☐ tests', '☑ build', 'Done'])
  queue.push([press(52, 301, '0:done')])
  await pollOnce(io, bridge)
  assert.deepEqual(await answers, { 'Which checks?': 'lint, build' })
})

test('answered in the terminal, the Telegram question stops waiting and is removed', async t => {
  const { tg, io, bridge } = await boundSession(t)
  trackCall(bridge, 'call-q', 'AskUserQuestion')
  const answers = askPermissionQuestion(io, bridge, ONE)
  await sleep(100)
  await closePermissionNotice(io, bridge, 'call-q')
  assert.equal(await answers, undefined)
  assert.equal(tg.named('deleteMessage').length, 1)
})
