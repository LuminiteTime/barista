import type { Binding } from './bindings.ts'
import { inboxOf, type Core } from './core.ts'
import { handleChoice } from './choices.ts'
import { AlbumCollector } from './inbound/album.ts'
import { Audience } from './inbound/audience.ts'
import { addNote, buildInbound } from './inbound/media.ts'
import { routeUpdate } from './inbound/route.ts'
import { transcribe } from './inbound/transcribe.ts'
import { log } from './log.ts'
import type { Message, Update } from './telegram/types.ts'

const ALBUM_QUIET_MS = 1_000

/** Feeds Telegram updates to the right session inboxes. */
export function createDelivery(core: Core) {
  let inOrder = Promise.resolve()
  // ponytail: one queue for all chats keeps "photo, then question" in order; per-binding queues if downloads get slow
  const audience = new Audience(core.api, core.bot, core.now)
  const deliverIfForBot = async (messages: Message[]) => {
    if (await audience.isForBot(messages)) await deliver(core, messages)
  }
  const albums = new AlbumCollector(ALBUM_QUIET_MS, messages => void (inOrder = inOrder.then(() => deliverIfForBot(messages))))

  return async function handleUpdates(updates: Update[]): Promise<void> {
    for (const update of updates) {
      if (update.callback_query) await handleChoice(core, update.callback_query)
      if (!isAllowedChat(core, update)) continue
      core.registry.observe(update)
      forgetOnMembershipChange(audience, update)
      const route = routeUpdate(update, { ownerId: core.config.ownerId, bindings: core.bindings, now: core.now() })
      if (route.kind === 'deliver') albums.add(route.message)
      if (route.kind === 'stop') inboxOf(core, route.binding.sessionId).push({ kind: 'stop' })
      if (route.kind === 'unsupported' && (await audience.isForBot([route.message]))) {
        await core.status.set(route.binding, [route.message.message_id], 'unsupported')
      }
    }
    core.persist()
  }
}

function forgetOnMembershipChange(audience: Audience, update: Update): void {
  const joinedOrLeft = update.message?.new_chat_members || update.message?.left_chat_member ? update.message.chat.id : undefined
  const chatId = update.my_chat_member?.chat.id ?? joinedOrLeft
  if (chatId !== undefined) audience.forget(chatId)
}

function isAllowedChat(core: Core, update: Update): boolean {
  const chatId = update.message?.chat.id ?? update.edited_message?.chat.id ?? update.my_chat_member?.chat.id
  return !core.config.chats || (chatId !== undefined && core.config.chats.includes(chatId))
}

async function deliver(core: Core, messages: Message[]): Promise<void> {
  const binding = bindingFor(core, messages[0])
  if (!binding) return
  try {
    const model = core.config.whisperModel ?? `${core.paths.models}/ggml-base.bin`
    const inbound = await buildInbound(messages, binding.title, {
      filesDir: core.paths.files,
      download: (fileId, dir, name) => core.api.download(fileId, dir, name),
      transcribe: path => transcribe(path, model),
    })
    if (messages.some(m => m.voice || m.audio) && !inbound.transcript) {
      addNote(inbound, 'Voice not transcribed: whisper-cpp failed or is missing (run `barista doctor`).')
    }
    inboxOf(core, binding.sessionId).push(inbound)
    log('info', `← ${binding.title}: message ${inbound.messageIds.join(',')}, ${inbound.files.length} file(s)`)
  } catch (error) {
    log('error', 'inbound delivery failed', error)
    await core.status.set(binding, messages.map(m => m.message_id), 'failed')
  }
}

function bindingFor(core: Core, message: Message): Binding | undefined {
  const threadId = message.is_topic_message ? message.message_thread_id : undefined
  return core.bindings.targetFor(message.chat.id, threadId, core.now())
}
