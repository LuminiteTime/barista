import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fromOfficialPlugin, readTokenFile } from '../src/cli/credentials.ts'
import { enabledTelegramPlugin } from '../src/cli/doctor.ts'

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'

test('the token file may be the bare token or an .env line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'barista-token-'))
  const [bare, env, empty] = ['bare', '.env', 'empty'].map(name => join(dir, name))
  await writeFile(bare, `${TOKEN}\n`)
  await writeFile(env, `# bot\nTELEGRAM_BOT_TOKEN=${TOKEN}\n`)
  await writeFile(empty, 'nothing here')
  assert.equal(await readTokenFile(bare), TOKEN)
  assert.equal(await readTokenFile(env), TOKEN)
  await assert.rejects(readTokenFile(empty), /No bot token in/)
})

test('token and owner are taken over from the official Telegram plugin when it was set up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'barista-official-'))
  assert.deepEqual(await fromOfficialPlugin(dir), {})
  await writeFile(join(dir, '.env'), `TELEGRAM_BOT_TOKEN=${TOKEN}\n`)
  await writeFile(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: ['1001'] }))
  assert.deepEqual(await fromOfficialPlugin(dir), { token: TOKEN, ownerId: 1001 })
  await writeFile(join(dir, 'access.json'), JSON.stringify({ allowFrom: ['1', '2'] }))
  assert.deepEqual(await fromOfficialPlugin(dir), { token: TOKEN }, 'several allowed users: ask who the owner is')
})

test('doctor spots the official Telegram plugin when it is enabled, since it polls the same token', () => {
  const list = (status: string) => `Installed plugins:\n\n  ❯ barista@barista\n    Scope: user\n    Status: ✔ enabled\n\n  ❯ telegram@claude-plugins-official\n    Version: 0.0.6\n    Scope: user\n    Status: ${status}\n`
  assert.equal(enabledTelegramPlugin(list('✔ enabled')), 'telegram@claude-plugins-official')
  assert.equal(enabledTelegramPlugin(list('✘ disabled')), undefined)
})
