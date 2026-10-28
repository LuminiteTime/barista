import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LABEL, renderPlist } from '../src/cli/launchd.ts'

test('plist keeps the daemon alive with absolute paths and a log', () => {
  const plist = renderPlist({ node: '/opt/node', script: '/app/cli/main.js', home: '/h/.barista', log: '/h/.barista/daemon.log' })
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`))
  assert.match(plist, /<string>\/opt\/node<\/string>\s+<string>\/app\/cli\/main.js<\/string>\s+<string>daemon<\/string>/)
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/)
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/)
  assert.match(plist, /<key>StandardOutPath<\/key><string>\/h\/.barista\/daemon.log<\/string>/)
  assert.match(plist, /\/opt\/homebrew\/bin/)
})
