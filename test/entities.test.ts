import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entitiesToMarkdown } from '../src/daemon/format/entities.ts'

test('plain text passes through', () => {
  assert.equal(entitiesToMarkdown('hello'), 'hello')
})

test('nested bold and link', () => {
  const text = 'see docs here'
  const md = entitiesToMarkdown(text, [
    { type: 'bold', offset: 0, length: 13 },
    { type: 'text_link', offset: 4, length: 4, url: 'https://x.dev' },
  ])
  assert.equal(md, '**see [docs](https://x.dev) here**')
})

test('emoji before an entity keeps utf-16 offsets', () => {
  const text = '🔥 hot'
  assert.equal(entitiesToMarkdown(text, [{ type: 'italic', offset: 3, length: 3 }]), '🔥 *hot*')
})

test('pre with language becomes a fenced block', () => {
  const text = 'run:\nls -la'
  const md = entitiesToMarkdown(text, [{ type: 'pre', offset: 5, length: 6, language: 'bash' }])
  assert.equal(md, 'run:\n```bash\nls -la\n```')
})

test('blockquote prefixes every line', () => {
  const md = entitiesToMarkdown('a\nb', [{ type: 'blockquote', offset: 0, length: 3 }])
  assert.equal(md, '> a\n> b')
})

test('strike, spoiler and code', () => {
  const md = entitiesToMarkdown('x y z', [
    { type: 'strikethrough', offset: 0, length: 1 },
    { type: 'spoiler', offset: 2, length: 1 },
    { type: 'code', offset: 4, length: 1 },
  ])
  assert.equal(md, '~~x~~ ||y|| `z`')
})
