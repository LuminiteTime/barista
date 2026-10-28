import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitText } from '../src/daemon/format/split.ts'

test('short text is one chunk', () => {
  assert.deepEqual(splitText('hi', 10), ['hi'])
})

test('splits on paragraphs and respects the limit', () => {
  const chunks = splitText('aaaa\n\nbbbb\n\ncccc', 10)
  assert.deepEqual(chunks, ['aaaa\n\nbbbb', 'cccc'])
  for (const c of chunks) assert.ok(c.length <= 10)
})

test('keeps a fenced code block whole when it fits', () => {
  const text = 'intro\n\n```\nline1\n\nline2\n```\n\nend'
  const chunks = splitText(text, 24)
  assert.ok(chunks.includes('```\nline1\n\nline2\n```'))
})

test('hard cuts a single oversized line', () => {
  const chunks = splitText('x'.repeat(25), 10)
  assert.deepEqual(chunks.map(c => c.length), [10, 10, 5])
})
