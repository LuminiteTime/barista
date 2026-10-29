import type { Io } from './io.ts'
import { callDaemon } from './client.ts'
import { setStages, type Bridge } from './bridge.ts'

const PREVIEW_LIMIT = 300
let counter = 0

export function trackCall(bridge: Bridge, toolUseId: string, tool: string): void {
  bridge.calls.set(toolUseId, tool)
}

/**
 * A permission dialog opened: tell the owner in Telegram where to answer.
 * The engine's PermissionRequest carries no tool_use_id, so the notice is pinned to the
 * in-flight call of that tool that has none yet; that call's end removes it.
 */
export async function openPermissionNotice(io: Io, bridge: Bridge, tool: string, input: unknown): Promise<void> {
  if (!bridge.binding) return
  const callId = [...bridge.calls].find(([id, name]) => name === tool && !bridge.notices.has(id))?.[0]
  const key = callId ?? `perm-${++counter}`
  const where = bridge.remoteUrl ? `in Remote Control: ${bridge.remoteUrl}` : 'in Remote Control'
  const text = `🔐 Claude asks to run ${tool}: ${preview(input)}\nAnswer in the terminal or ${where}`
  const posting = callDaemon(io, 'POST', '/notice', { sessionId: bridge.sessionId, key, text }).then(
    () => undefined,
    () => void bridge.notices.delete(key),
  )
  bridge.notices.set(key, posting)
  await setStages(io, bridge, bridge.current, 'waiting')
  await posting
}

/** The call is over (allowed, denied or finished): remove its notice, waiting for the post if it is still in flight. */
export async function closePermissionNotice(io: Io, bridge: Bridge, key: string, resume = true): Promise<void> {
  bridge.calls.delete(key)
  const posting = bridge.notices.get(key)
  if (!posting) return
  await posting
  bridge.notices.delete(key)
  await callDaemon(io, 'POST', '/notice/close', { sessionId: bridge.sessionId, key }).catch(() => undefined)
  if (resume && bridge.notices.size === 0) await setStages(io, bridge, bridge.current, 'working')
}

/** Turn or session over: nothing may stay behind. `resume` is false when no work follows (session end). */
export async function closePermissionNotices(io: Io, bridge: Bridge, resume: boolean): Promise<void> {
  for (const key of [...bridge.notices.keys()]) await closePermissionNotice(io, bridge, key, resume)
}

function preview(input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>
  const text = String(record.description ?? record.command ?? record.file_path ?? record.url ?? JSON.stringify(input))
  return text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) + '…' : text
}
