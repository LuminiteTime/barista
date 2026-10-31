import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBridge, finishTurn, startTurn, type Bridge } from '../mod/hooks/bridge.ts'
import { IMAGE_SIZE, PALETTE, rgbaOf, SCENES, SIZE } from '../mod/hooks/clawd.ts'
import type { Io } from '../mod/hooks/io.ts'
import { bandFor } from '../mod/hooks/status.ts'
import { boundSession, fakeIo } from './mod-harness.ts'

/** An Io whose band and timers the test reads: `fire()` runs what is waiting on `after`. */
function watched(base: Io) {
  const scenes: string[] = []
  const timers: (() => void)[] = []
  const io: Io = { ...base, status: band => void scenes.push(band.scene), after: (_ms, fn) => void timers.push(fn) }
  return { io, scenes, timers, fire: () => timers.splice(0).forEach(fn => fn()) }
}

const bound = (): Bridge => ({ ...createBridge(), binding: { chatId: -100, threadId: 7, title: 'Мастерская / Test topic 1' } })

test('every frame is a full square of known colors, so the sprite never jumps', () => {
  const frames = Object.entries(SCENES).flatMap(([scene, { frames }]) => frames.map(frame => ({ scene, frame })))
  for (const { scene, frame } of frames) {
    assert.deepEqual(frame.map(row => row.length), Array<number>(SIZE).fill(SIZE), scene)
    assert.ok([...frame.join('')].every(pixel => pixel in PALETTE), scene)
    assert.equal(atob(rgbaOf(frame)).length, IMAGE_SIZE * IMAGE_SIZE * 4, scene)
  }
})

test('where no picture can be drawn, each scene plays in emoji, frame for frame', () => {
  for (const [scene, { frames, emoji }] of Object.entries(SCENES)) assert.equal(emoji.length, frames.length, scene)
  assert.deepEqual([...new Set(SCENES.brew.emoji)], ['🫘', '💧', '☕'])
  assert.equal(SCENES.spill.emoji.at(-1), '💧')
})

test('Clawd stands still unless something is happening', () => {
  for (const scene of ['idle', 'sleep', 'down'] as const) assert.equal(SCENES[scene].frames.length, 1, scene)
  assert.equal(bandFor(createBridge()).scene, 'sleep')
  assert.equal(bandFor(bound()).scene, 'idle')
  assert.equal(bandFor(bound(), new Error('boom')).scene, 'down')
})

test('Clawd brews through a turn, presents the sent answer, then settles', async t => {
  const { io: base, bridge } = await boundSession(t)
  const { io, scenes, fire } = watched(base)
  await startTurn(io, bridge, 't1', 'typed in the terminal')
  await finishTurn(io, bridge, 'answer', 'готово')
  fire()
  assert.deepEqual(scenes, ['brew', 'serve', 'idle'])
})

test('a failed turn spills; an unbound session has nothing to present', async t => {
  const { io: base, bridge } = await boundSession(t)
  const { io, scenes } = watched(base)
  await startTurn(io, bridge, 't1', 'typed')
  await finishTurn(io, bridge, 'error', '')
  assert.equal(scenes.at(-1), 'spill')

  const unbound = watched(fakeIo('/nowhere', []))
  const alone = createBridge()
  await startTurn(unbound.io, alone, 't2', 'typed')
  await finishTurn(unbound.io, alone, 'answer', 'answer')
  assert.deepEqual(unbound.scenes, ['brew', 'sleep'])
})

test('an old moment ending does not cut a newer one short', async t => {
  const { io: base, bridge } = await boundSession(t)
  const { io, timers } = watched(base)
  await finishTurn(io, bridge, 'answer', 'готово')
  await finishTurn(io, bridge, 'error', '')
  timers[0]()
  assert.equal(bandFor(bridge).scene, 'spill')
  timers[1]()
  assert.equal(bandFor(bridge).scene, 'idle')
})

test('a question waiting for the owner raises a hand over the brewing', () => {
  const bridge = { ...bound(), runningTurnId: 't1' }
  assert.equal(bandFor(bridge).scene, 'brew')
  bridge.notices.set('call-1', Promise.resolve())
  assert.equal(bandFor(bridge).scene, 'ask')
})
