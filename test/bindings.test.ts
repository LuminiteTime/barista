import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Bindings, LIVE_WINDOW_MS } from '../src/daemon/bindings.ts'

const TOPIC = { chatId: -100, threadId: 7, title: 'Chat / Topic' }

test('a live session holds its topic', () => {
  const bindings = new Bindings()
  bindings.bind({ sessionId: 'a', target: TOPIC, now: 0 })
  assert.throws(() => bindings.bind({ sessionId: 'b', target: TOPIC, now: 1000 }), { code: 'TOPIC_TAKEN' })
  assert.equal(bindings.targetFor(-100, 7, 1000)?.sessionId, 'a')
})

test('a stale holder loses the topic, force always steals', () => {
  const bindings = new Bindings()
  bindings.bind({ sessionId: 'a', target: TOPIC, now: 0 })
  bindings.bind({ sessionId: 'b', target: TOPIC, now: LIVE_WINDOW_MS + 1 })
  assert.equal(bindings.get('a'), undefined)
  bindings.bind({ sessionId: 'c', target: TOPIC, now: LIVE_WINDOW_MS + 2, force: true })
  assert.equal(bindings.targetFor(-100, 7, LIVE_WINDOW_MS + 2)?.sessionId, 'c')
})

test('offline bindings receive nothing until touched again', () => {
  const bindings = new Bindings()
  bindings.bind({ sessionId: 'a', target: TOPIC, now: 0 })
  assert.equal(bindings.targetFor(-100, 7, LIVE_WINDOW_MS + 1), undefined)
  bindings.touch('a', LIVE_WINDOW_MS + 1)
  assert.equal(bindings.targetFor(-100, 7, LIVE_WINDOW_MS + 1)?.sessionId, 'a')
})

test('threads are matched exactly', () => {
  const bindings = new Bindings()
  bindings.bind({ sessionId: 'a', target: TOPIC, now: 0 })
  assert.equal(bindings.targetFor(-100, undefined, 0), undefined)
  assert.equal(bindings.targetFor(-100, 8, 0), undefined)
})

test('rename follows /clear and JSON round trip keeps bindings', () => {
  const bindings = new Bindings()
  bindings.bind({ sessionId: 'a', target: TOPIC, now: 0 })
  bindings.rename('a', 'a2')
  const restored = Bindings.fromJSON(JSON.parse(JSON.stringify(bindings.toJSON())))
  assert.equal(restored.get('a2')?.title, 'Chat / Topic')
  restored.unbind('a2')
  assert.equal(restored.get('a2'), undefined)
})
