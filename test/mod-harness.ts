import { mkdtemp, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { bindSession, createBridge } from '../mod/hooks/bridge.ts'
import type { HttpInit, HttpResponse, Io } from '../mod/hooks/io.ts'
import { startDaemon } from '../src/daemon/main.ts'
import { paths } from '../src/daemon/paths.ts'
import type { Update } from '../src/daemon/telegram/types.ts'
import { fakeTelegram } from './fake-telegram.ts'

const FORUM = { id: -100, type: 'supergroup', title: 'Мастерская', is_forum: true } as const
export const topicMessage = (id: number, text: string): Update => ({
  update_id: id,
  message: {
    message_id: id, date: 0, chat: FORUM, from: { id: 1, first_name: 'O' }, message_thread_id: 7, is_topic_message: true, text,
    reply_to_message: { message_id: 7, date: 0, chat: FORUM, forum_topic_created: { name: 'Test topic 1' } },
  },
})

export function socketFetch(url: string, init: HttpInit): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const { pathname, search } = new URL(url)
    const req = request({ socketPath: init.socketPath, method: init.method, path: pathname + search, headers: init.headers }, res => {
      let text = ''
      res.on('data', c => (text += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, ok: (res.statusCode ?? 0) < 300, text }))
    })
    req.on('error', reject)
    req.end(init.body)
  })
}

export function fakeIo(home: string, submitted: string[]): Io {
  return {
    fetch: socketFetch,
    baristaHome: async () => home,
    sessionId: async () => 'session-1',
    status: () => {},
    toast: () => {},
    submit: async text => (submitted.push(text), { isDropped: false }),
    abortTurn: async () => {},
    after: (_ms, fn) => void setImmediate(fn),
    commandNames: async () => [],
    runCommand: async () => undefined,
  }
}

/** A daemon on a fake Telegram and one mod session bound to its forum topic. */
export async function boundSession(t: TestContext) {
  const queue: Update[][] = [[topicMessage(1, 'learn')]]
  let nextId = 300
  const tg = await fakeTelegram({
    getMe: () => ({ id: 9, first_name: 'B', username: 'b' }),
    getUpdates: async () => queue.shift() ?? (await sleep(20), []),
    sendRichMessage: () => ({ message_id: 100 }),
    sendMessage: () => ({ message_id: ++nextId }),
  })
  const home = await mkdtemp(join(tmpdir(), 'barista-mod-'))
  await writeFile(join(home, 'config.json'), JSON.stringify({ token: 'T', ownerId: 1, apiBase: tg.base }))
  const daemon = await startDaemon(paths(home))
  t.after(async () => (await daemon.stop(), await tg.close()))
  await sleep(100)
  const submitted: string[] = []
  const io = fakeIo(home, submitted)
  const bridge = createBridge()
  await bindSession(io, bridge, { chat: 'Мастерская', topic: 'Test topic 1', create: false, force: false })
  const reactions = () => tg.named('setMessageReaction').map(c => `${c.params.message_id}${(c.params.reaction as { emoji: string }[])[0].emoji}`)
  return { tg, queue, home, io, bridge, submitted, reactions }
}
