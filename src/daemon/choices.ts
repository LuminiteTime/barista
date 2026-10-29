import { inboxOf, type Core } from './core.ts'
import { log } from './log.ts'
import { modKey } from './replies.ts'
import type { CallbackQuery } from './telegram/types.ts'

/** A button under a notice was pressed: the owner's press goes to the session that posted the notice. */
export async function handleChoice(core: Core, query: CallbackQuery): Promise<void> {
  const notice = [...core.notices.values()].find(n => n.chatId === query.message?.chat.id && n.messageId === query.message.message_id)
  const answer = (text: string) => core.api.call('answerCallbackQuery', { callback_query_id: query.id, text }).catch(error => log('debug', 'answerCallbackQuery failed', error))
  log('info', `← button press by ${query.from.id === core.config.ownerId ? 'the owner' : 'someone else'}, notice ${notice ? 'found' : 'unknown'}`)
  if (query.from.id !== core.config.ownerId) return void (await answer('Only the owner of this bot can answer.'))
  if (!notice || query.data === undefined) return void (await answer('This question is already answered.'))
  log('info', `← button ${query.data} on notice ${notice.messageId}`)
  inboxOf(core, notice.sessionId).push({ kind: 'choice', key: modKey(notice), data: query.data })
  await answer('')
}
