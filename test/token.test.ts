import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readTokenFile } from '../src/cli/setup.ts'

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
