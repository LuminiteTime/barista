import type { AttachRequest, BindRequest, Health, NoticeRequest, SendFilesRequest, SendRequest, StatusRequest } from '../../mod/hooks/protocol.ts'
import { isLive } from './bindings.ts'
import type { Core } from './core.ts'
import { BaristaError } from './errors.ts'
import { closeNotice, openNotice, sendAnswer, sendArtifacts, setStatus } from './replies.ts'
import type { Request, Routes } from './server.ts'
import { attach, bind, takeInbox, unbind } from './sessions.ts'

export const VERSION = '1.1.0'

/** The socket API of spec §6, mapped onto the use cases. */
export function routesFor(core: Core): Routes {
  return {
    'GET /health': () => health(core),
    'GET /chats': () => core.registry.list(),
    'GET /bindings': () => core.bindings.toJSON().map(b => ({ ...b, isLive: isLive(b, core.now()) })),
    'POST /attach': ({ body }) => ({ binding: attach(core, as<AttachRequest>(body, 'sessionId')) }),
    'POST /bind': async ({ body }) => ({ binding: await bind(core, as<BindRequest>(body, 'sessionId', 'chat')) }),
    'POST /unbind': async ({ body }) => unbind(core, as<{ sessionId: string }>(body, 'sessionId').sessionId),
    'GET /inbox': ({ query, signal }) => inbox(core, query, signal),
    'POST /send': async ({ body }) => ({ messageIds: await sendAnswer(core, as<SendRequest>(body, 'sessionId', 'text')) }),
    'POST /send-files': ({ body }) => sendArtifacts(core, as<SendFilesRequest>(body, 'sessionId', 'files')),
    'POST /status': ({ body }) => setStatus(core, as<StatusRequest>(body, 'sessionId', 'messageIds', 'stage')),
    'POST /notice': ({ body }) => openNotice(core, as<NoticeRequest>(body, 'sessionId', 'key', 'text')),
    'POST /notice/close': ({ body }) => {
      const { sessionId, key } = as<NoticeRequest>(body, 'sessionId', 'key')
      return closeNotice(core, sessionId, key)
    },
  }
}

async function inbox(core: Core, query: URLSearchParams, signal: Request['signal']) {
  const sessionId = query.get('sessionId')
  if (!sessionId) throw new BaristaError('BAD_REQUEST', 'sessionId is required.')
  const waitMs = Number(query.get('wait') ?? 0) * 1000
  return { items: await takeInbox(core, sessionId, waitMs, signal), binding: core.bindings.get(sessionId) ?? null }
}

function health(core: Core): Health {
  return {
    version: VERSION,
    bot: core.bot.username ?? String(core.bot.id),
    canReadGroups: core.bot.can_read_all_group_messages === true,
    uptimeMs: core.now() - core.startedAt,
  }
}

function as<T>(body: Record<string, unknown>, ...required: string[]): T {
  const missing = required.filter(key => body[key] === undefined || body[key] === '')
  if (missing.length) throw new BaristaError('BAD_REQUEST', `Missing: ${missing.join(', ')}.`)
  return body as T
}
