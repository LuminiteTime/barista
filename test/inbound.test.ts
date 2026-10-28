import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { AlbumCollector } from '../src/daemon/inbound/album.ts'
import { buildInbound, type InboundDeps } from '../src/daemon/inbound/media.ts'
import { transcribe } from '../src/daemon/inbound/transcribe.ts'
import type { Message } from '../src/daemon/telegram/types.ts'

const CHAT = { id: -100, type: 'supergroup', title: 'F', is_forum: true } as const
const base = (extra: Partial<Message>): Message => ({ message_id: 9, date: 0, chat: CHAT, message_thread_id: 7, ...extra })

async function deps(over: Partial<InboundDeps> = {}): Promise<InboundDeps> {
  const dir = await mkdtemp(join(tmpdir(), 'barista-'))
  return {
    filesDir: dir,
    download: async (_id, folder, name) => join(folder, name ?? 'x'),
    transcribe: async () => 'привет',
    ...over,
  }
}

test('text, reply quote and header', async () => {
  const reply = base({ message_id: 3, text: 'x'.repeat(400) })
  const inbound = await buildInbound([base({ text: 'redo this', reply_to_message: reply })], 'F / T', await deps())
  assert.equal(inbound.header, '[Telegram · F / T]')
  assert.equal(inbound.text, 'redo this')
  assert.equal(inbound.replyTo?.length, 301)
  assert.deepEqual(inbound.messageIds, [9])
})

test('the topic-creation pseudo reply is not a quote', async () => {
  const root = base({ message_id: 7, forum_topic_created: { name: 'T' } })
  const inbound = await buildInbound([base({ text: 'hi', reply_to_message: root })], 'F / T', await deps())
  assert.equal(inbound.replyTo, undefined)
})

test('album photos download to the session folder, largest size wins', async () => {
  const photo = (id: number) => base({ message_id: id, photo: [{ file_id: `s${id}` }, { file_id: `l${id}` }] })
  const seen: string[] = []
  const d = await deps({ download: async (id, folder, name) => (seen.push(id), join(folder, name ?? id)) })
  const inbound = await buildInbound([photo(1), { ...photo(2), caption: 'two' }], 'F / T', d)
  assert.deepEqual(seen, ['l1', 'l2'])
  assert.equal(inbound.files.length, 2)
  assert.equal(inbound.text, 'two')
})

test('voice is downloaded and transcribed', async () => {
  const inbound = await buildInbound([base({ voice: { file_id: 'v', file_size: 10 } })], 'F / T', await deps())
  assert.equal(inbound.transcript, 'привет')
})

test('files over 20 MB are skipped with a FILE_TOO_BIG note', async () => {
  const big = base({ document: { file_id: 'd', file_size: 21 * 1024 * 1024, file_name: 'big.zip' } })
  const inbound = await buildInbound([big], 'F / T', await deps())
  assert.equal(inbound.files.length, 0)
  assert.match(inbound.note ?? '', /FILE_TOO_BIG/)
})

test('album collector flushes a group after the quiet window', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const flushed: number[][] = []
  const albums = new AlbumCollector(1000, group => flushed.push(group.map(m => m.message_id)))
  albums.add(base({ message_id: 1, media_group_id: 'g' }))
  albums.add(base({ message_id: 2, media_group_id: 'g' }))
  t.mock.timers.tick(999)
  assert.equal(flushed.length, 0)
  t.mock.timers.tick(1)
  assert.deepEqual(flushed, [[1, 2]])
})

test('transcribe runs ffmpeg then whisper-cli and never throws', async () => {
  const runs: string[] = []
  const ok = await transcribe('/a.ogg', '/m.bin', async (cmd, args) => (runs.push(cmd + ' ' + args.join(' ')), ' text \n'))
  assert.equal(ok, 'text')
  assert.match(runs[0], /^ffmpeg .*-ar 16000 -ac 1/)
  assert.match(runs[1], /^whisper-cli -m \/m.bin -f \/a.ogg.wav/)
  assert.equal(await transcribe('/a.ogg', '/m.bin', async () => Promise.reject(new Error('no'))), undefined)
})

test('in a plain supergroup a reply to the chain root still quotes it', async () => {
  const group = { id: -200, type: 'supergroup', title: 'G' } as const
  const answer: Message = { message_id: 50, date: 0, chat: group, text: 'the answer' }
  const reply: Message = { message_id: 51, date: 0, chat: group, message_thread_id: 50, text: 'why?', reply_to_message: answer }
  const inbound = await buildInbound([reply], 'G', await deps())
  assert.equal(inbound.replyTo, 'the answer')
})

test('a sender-controlled file name cannot leave the files folder', async () => {
  const d = await deps()
  const inbound = await buildInbound([base({ document: { file_id: 'd', file_name: '../../../etc/x.txt' } })], 'F / T', d)
  assert.ok(inbound.files[0].startsWith(d.filesDir))
  assert.equal(basename(inbound.files[0]), '9-x.txt')
})
