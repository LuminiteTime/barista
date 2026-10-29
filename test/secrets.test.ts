import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findSecrets } from '../scripts/check-secrets.ts'

// Split so this file passes its own scan.
const TOKEN = ['123456789', 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawx'].join(':')
const KEY_HEADER = ['-----BEGIN OPENSSH', 'PRIVATE KEY-----'].join(' ')

test('finds secret shapes and your own values, and never echoes them', () => {
  const files = [
    { path: 'src/a.ts', text: `const ok = 1\nconst token = '${TOKEN}'\n` },
    { path: 'test/b.ts', text: 'chat: "My Private Chat"\nid: 4242\n' },
    { path: 'keys/id', text: `${KEY_HEADER}\n` },
  ]
  const found = findSecrets(files, ['my private chat', '4242'])
  assert.deepEqual(found, [
    { path: 'src/a.ts', line: 2, what: 'Telegram bot token' },
    { path: 'test/b.ts', line: 1, what: '.secrets.local value #1' },
    { path: 'test/b.ts', line: 2, what: '.secrets.local value #2' },
    { path: 'keys/id', line: 1, what: 'private key' },
  ])
  assert.ok(!JSON.stringify(found).includes(TOKEN))
})

test('clean files and blank lines in .secrets.local find nothing', () => {
  assert.deepEqual(findSecrets([{ path: 'a.ts', text: 'const fakeToken = "123:abc"\n' }], ['', '  ']), [])
})
