import type { NoticeRequest, SendFilesRequest, SendRequest, StatusRequest } from '../../mod/hooks/protocol.ts'
import { requireBinding, type Core } from './core.ts'
import { log } from './log.ts'
import { deleteMessage, postNotice, sendFiles, sendText } from './outbound.ts'

export async function sendAnswer(core: Core, { sessionId, text }: SendRequest): Promise<number[]> {
  const binding = requireBinding(core, sessionId)
  const ids = await sendText(core.api, binding, text)
  log('info', `→ ${binding.title}: answer, ${text.length} chars, messages ${ids.join(',')}`)
  return ids
}

export async function sendArtifacts(core: Core, { sessionId, files, caption }: SendFilesRequest): Promise<number[]> {
  const binding = requireBinding(core, sessionId)
  const ids = await sendFiles(core.api, binding, files, caption)
  log('info', `→ ${binding.title}: ${files.length} file(s), messages ${ids.join(',')}`)
  return ids
}

export async function setStatus(core: Core, { sessionId, messageIds, stage }: StatusRequest): Promise<void> {
  await core.status.set(requireBinding(core, sessionId), messageIds, stage)
}

export async function openNotice(core: Core, { sessionId, key, text }: NoticeRequest): Promise<void> {
  const binding = requireBinding(core, sessionId)
  await closeNotice(core, sessionId, key)
  const messageId = await postNotice(core.api, binding, text)
  core.notices.set(noticeKey(sessionId, key), { key: noticeKey(sessionId, key), sessionId, chatId: binding.chatId, messageId })
  core.persist()
}

export async function closeNotice(core: Core, sessionId: string, key: string): Promise<void> {
  const notice = core.notices.get(noticeKey(sessionId, key))
  if (!notice) return
  core.notices.delete(notice.key)
  core.persist()
  await deleteMessage(core.api, notice.chatId, notice.messageId).catch(() => undefined)
}

function noticeKey(sessionId: string, key: string): string {
  return `${sessionId}:${key}`
}
