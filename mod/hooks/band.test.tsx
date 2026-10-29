import type { CommandRunInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const BAND = {
  plugin: 'barista',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const HEALTH = { version: '0.1.0', bot: 'demo_bot', canReadGroups: true, uptimeMs: 1 }

/** Stands for the engine and the daemon: attach answers `binding`, /health a live bot. */
function engine(on: Parameters<TestBody>[1], binding: object | null): void {
  on('command.register', () => ({ value: { command: 'tg' } }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('env.get', () => ({ value: '/home/u/.barista' }))
  on('clock.every', () => ({ value: undefined }))
  on('http.fetch', (_$, e) => ({
    value: { status: 200, ok: true, headers: {}, text: JSON.stringify(e.url.endsWith('/health') ? HEALTH : { binding, items: [] }) },
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}

test('the band names the topic this session listens to', async ($, on) => {
  engine(on, { chatId: -100, threadId: 7, title: 'Мастерская / Test topic 1' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /Test topic 1/ }))?.text).toBe('● Мастерская / Test topic 1')
  await ui.unmount()
})

test('unbound, the band and /tg status say how to bind instead of dumping usage', async ($, on) => {
  engine(on, null)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /not bound/ }))?.text).toBe('○ not bound')
  await ui.unmount()
  const { text } = await $.command.run({ command: 'tg', args: 'status' } as CommandRunInput)
  expect(text).toBe('○ Not bound (daemon up, bot @demo_bot). Bind this session: /tg bind <chat> / <topic>')
})
