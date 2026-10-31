import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { finishTurn, pollOnce, startTurn } from '../mod/hooks/bridge.ts'
import { openPermissionNotice } from '../mod/hooks/permissions.ts'
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

test('the permission notice says what Claude asks and where to answer', async t => {
  const { tg, io, bridge } = await boundSession(t)
  await openPermissionNotice(io, bridge, 'Bash', { command: 'make' })
  assert.equal(tg.named('sendMessage').at(-1)?.params.text, '🔐 Claude asks to run Bash: make\nAnswer in the terminal.')
})
