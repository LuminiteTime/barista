import { expect, test } from 'claude-code/testing'

type Fetched = { url: string; body?: string }

test('/tg bind posts to the daemon and the tools are registered', async ($, on) => {
  const fetched: Fetched[] = []
  const tools: string[] = []
  on('command.register', () => ({ value: { command: 'tg' } }))
  on('tool.register', (_$, e) => (tools.push(e.name), { value: { tool: `mcp__barista__${e.name}` } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('env.get', () => ({ value: '/home/u/.barista' }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('http.fetch', (_$, e) => {
    fetched.push({ url: e.url, body: e.init?.body })
    const binding = { chatId: -100, threadId: 7, title: 'Мастерская / Test topic 1' }
    const text = e.url.endsWith('/attach') ? '{"binding":null}' : JSON.stringify({ binding })
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: 'engine' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(tools).toContain('telegram_send_files')

  const { text } = await $.command.run({ command: 'tg', args: 'bind Мастерская / Test topic 1' })
  expect(text).toContain('Bound to Telegram: Мастерская / Test topic 1')
  const bind = fetched.find(f => f.url.endsWith('/bind'))
  expect(JSON.parse(bind?.body ?? '{}')).toEqual({ sessionId: 'sess-1', chat: 'Мастерская', topic: 'Test topic 1', create: false, force: false })
})

test('/tg explains an unreachable daemon instead of failing silently', async ($, on) => {
  on('command.register', () => ({ value: { command: 'tg' } }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('env.get', () => ({ value: '/home/u/.barista' }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('http.fetch', () => {
    throw new Error('ECONNREFUSED')
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'tg', args: 'bind Work / backend' })
  expect(text).toContain('DAEMON_DOWN')
})
