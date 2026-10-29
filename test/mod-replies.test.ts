import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { finishTurn, pollOnce, startTurn } from '../mod/hooks/bridge.ts'
import { openPermissionNotice } from '../mod/hooks/permissions.ts'
import { startRemoteControl } from '../mod/hooks/remote.ts'
import { runTool } from '../mod/hooks/tools.ts'
import { boundSession, topicMessage } from './mod-harness.ts'

test('answers and files of a Telegram turn reply to its message; a terminal turn does not reply', async t => {
  const { tg, queue, home, io, bridge, submitted } = await boundSession(t)
  tg.handlers.sendDocument = () => ({ message_id: 600 })
  const log = join(home, 'build.log')
  await writeFile(log, 'ok')
  queue.push([topicMessage(2, 'вопрос')])
  await pollOnce(io, bridge)
  await sleep(20)
  await startTurn(io, bridge, 't1', submitted[0])
  await runTool(io, bridge, 'mcp__barista__telegram_send_files', { files: [{ path: log }] })
  await finishTurn(io, bridge, 'answer', 'ответ')
  await startTurn(io, bridge, 't2', 'typed in the terminal')
  await finishTurn(io, bridge, 'answer', 'terminal answer')
  const reply = { message_id: 2, allow_sending_without_reply: true }
  assert.deepEqual(tg.named('sendDocument')[0].params.reply_parameters, reply)
  const [telegram, terminal] = tg.named('sendRichMessage').map(c => c.params.reply_parameters)
  assert.deepEqual(telegram, reply)
  assert.equal(terminal, undefined)
})

test('binding again does not run /remote-control twice: a second run opens its panel', async t => {
  const { tg, io: base, bridge } = await boundSession(t)
  let runs = 0
  const io = { ...base, commandNames: async () => ['remote-control'], runCommand: async () => (runs++, 'Remote Control: https://claude.ai/code/session_1') }
  startRemoteControl(io, bridge)
  await sleep(50)
  startRemoteControl(io, bridge)
  await sleep(50)
  assert.equal(runs, 1)
  const notices = tg.named('sendRichMessage').map(c => (c.params.rich_message as { markdown: string }).markdown)
  assert.equal(notices.filter(text => text.includes('session_1')).length, 2, 'the new topic still gets the link')
})

test('the permission notice links to this session in Remote Control', async t => {
  const { tg, io: base, bridge } = await boundSession(t)
  const io = { ...base, commandNames: async () => ['remote-control'], runCommand: async () => 'Remote Control: https://claude.ai/code/session_1' }
  startRemoteControl(io, bridge)
  await sleep(50)
  await openPermissionNotice(io, bridge, 'Bash', { command: 'make' })
  assert.match(String(tg.named('sendMessage').at(-1)?.params.text), /https:\/\/claude\.ai\/code\/session_1/)
})
