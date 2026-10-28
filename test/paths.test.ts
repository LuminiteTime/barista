import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paths } from '../src/daemon/paths.ts'

test('paths live under BARISTA_HOME', () => {
  process.env.BARISTA_HOME = '/x'
  assert.equal(paths().socket, '/x/barista.sock')
  assert.equal(paths().config, '/x/config.json')
})
