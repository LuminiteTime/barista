import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { VERSION } from '../src/daemon/routes.ts'

test('the daemon, the mod and the package report one version', () => {
  const version = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).version
  assert.equal(VERSION, version('../package.json'))
  assert.equal(version('../mod/.claude-plugin/plugin.json'), VERSION)
})
