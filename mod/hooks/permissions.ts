import type { Io } from './io.ts'
import { callDaemon } from './client.ts'
import { setStage, type Bridge } from './bridge.ts'

const PREVIEW_LIMIT = 300
let counter = 0

/** A permission dialog opened: tell the owner in Telegram where to answer. */
export async function openPermissionNotice(io: Io, bridge: Bridge, tool: string, input: unknown): Promise<void> {
  if (!bridge.binding) return
  const key = `perm-${++counter}`
  bridge.notices.add(key)
  const text = `🔐 Claude asks to run ${tool}: ${preview(input)}\nAnswer in the terminal or in Remote Control.`
  await callDaemon(io, 'POST', '/notice', { sessionId: bridge.sessionId, key, text }).catch(() => bridge.notices.delete(key))
  if (bridge.current) await setStage(io, bridge, bridge.current, 'waiting')
}

/** The question was settled (or the turn ended): remove every open notice so nothing stale is left. */
export async function closePermissionNotices(io: Io, bridge: Bridge): Promise<void> {
  if (bridge.notices.size === 0) return
  const keys = [...bridge.notices]
  bridge.notices.clear()
  for (const key of keys) await callDaemon(io, 'POST', '/notice/close', { sessionId: bridge.sessionId, key }).catch(() => undefined)
  if (bridge.current) await setStage(io, bridge, bridge.current, 'working')
}

function preview(input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>
  const text = String(record.description ?? record.command ?? record.file_path ?? record.url ?? JSON.stringify(input))
  return text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) + '…' : text
}
