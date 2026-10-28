import type { AttachRequest, BindRequest, BindingView, InboxItem } from '../../mod/hooks/protocol.ts'
import { inboxOf, type Core } from './core.ts'
import { BaristaError } from './errors.ts'
import { log } from './log.ts'
import { removeNotice } from './replies.ts'
import { TelegramError } from './telegram/api.ts'
import type { Chat, ForumTopic } from './telegram/types.ts'

const MAX_WAIT_MS = 25_000
const CHAT_ID = /^-?\d+$/
const ME = /^(me|dm)$/i

export function attach(core: Core, { sessionId, previousSessionId }: AttachRequest): BindingView | null {
  if (previousSessionId) core.bindings.rename(previousSessionId, sessionId)
  const binding = core.bindings.touch(sessionId, core.now())
  core.persist()
  return binding ? view(binding) : null
}

export async function bind(core: Core, request: BindRequest): Promise<BindingView> {
  const target = await resolveTarget(core, request)
  const binding = core.bindings.bind({ sessionId: request.sessionId, target, now: core.now(), force: request.force })
  log('info', `session ${request.sessionId} bound to ${binding.title}`)
  core.persist()
  return view(binding)
}

export async function unbind(core: Core, sessionId: string): Promise<void> {
  const binding = core.bindings.get(sessionId)
  if (binding) core.status.stopTyping(binding)
  core.bindings.unbind(sessionId)
  await clearNotices(core, sessionId)
  core.persist()
}

export async function takeInbox(core: Core, sessionId: string, waitMs: number, signal?: AbortSignal): Promise<InboxItem[]> {
  core.bindings.touch(sessionId, core.now())
  return inboxOf(core, sessionId).take(Math.min(waitMs, MAX_WAIT_MS), signal)
}

/** Deletes notices whose question is settled or whose session is gone, so nothing stale hangs in Telegram. */
export async function clearNotices(core: Core, sessionId?: string): Promise<void> {
  const offline = new Set(core.bindings.offline(core.now()).map(b => b.sessionId))
  for (const notice of [...core.notices.values()]) {
    const isTarget = sessionId ? notice.sessionId === sessionId : offline.has(notice.sessionId) || !core.bindings.get(notice.sessionId)
    if (isTarget) await removeNotice(core, notice)
  }
  core.persist()
}

/** Cleanup for sessions that died without a word (killed terminal, crash): typing, inboxes, notices. */
export async function sweep(core: Core): Promise<void> {
  for (const binding of core.bindings.offline(core.now())) {
    core.status.stopTyping(binding)
    core.inboxes.delete(binding.sessionId)
  }
  await clearNotices(core)
}

async function resolveTarget(core: Core, request: BindRequest): Promise<BindingView> {
  const { topic, create } = request
  const chat = ME.test(request.chat.trim()) ? String(core.config.ownerId) : request.chat
  if (CHAT_ID.test(chat)) await learnChat(core, Number(chat))
  try {
    return core.registry.resolve(chat, topic)
  } catch (error) {
    if (!create || !topic || !(error instanceof BaristaError) || error.code !== 'TOPIC_UNKNOWN') throw error
    return createTopic(core, chat, topic)
  }
}

/** Asks Telegram about a chat the bot has not seen in updates yet (by id: Bot API cannot search by title). */
export async function learnChat(core: Core, chatId: number): Promise<void> {
  if (core.config.chats && !core.config.chats.includes(chatId)) {
    throw new BaristaError('CHAT_UNKNOWN', `Chat ${chatId} is not in the chats allowlist, so its messages would be ignored.`, 'Add it: barista setup --chats <ids>')
  }
  const chat = await core.api.call<Chat>('getChat', { chat_id: chatId }).catch(() => {
    throw new BaristaError('CHAT_UNKNOWN', `Telegram has no chat ${chatId} for this bot.`, 'Add the bot to the chat first.')
  })
  core.registry.learnChat(chat)
  core.persist()
}

async function createTopic(core: Core, chatName: string, name: string): Promise<BindingView> {
  const chat = core.registry.findChat(chatName)
  const topic = await core.api.call<ForumTopic>('createForumTopic', { chat_id: chat.id, name }).catch(rightsError)
  core.registry.addTopic(chat.id, topic.message_thread_id, topic.name)
  return core.registry.resolve(chatName, name)
}

function rightsError(error: unknown): never {
  if (error instanceof TelegramError && /rights|admin/i.test(error.message)) {
    throw new BaristaError('NO_RIGHTS', `Telegram refused: ${error.message}`, 'Make the bot an admin with the "Manage Topics" right.')
  }
  throw error
}

function view({ chatId, threadId, title }: BindingView): BindingView {
  return { chatId, threadId, title }
}
