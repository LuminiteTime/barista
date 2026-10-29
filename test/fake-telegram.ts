import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

export type Call = { method: string; params: Record<string, unknown>; multipart: boolean }
type Reply = unknown | { error_code: number; description: string; retry_after?: number }
export type Handler = (params: Record<string, unknown>) => Reply | Promise<Reply>

/** A tiny stand-in for api.telegram.org: answers Bot API methods from handlers and records every call. */
export async function fakeTelegram(handlers: Record<string, Handler> = {}) {
  const calls: Call[] = []
  const server = createServer(async (req, res) => {
    const url = req.url ?? ''
    if (url.startsWith('/file/')) return void res.end('file-bytes')
    const method = url.split('/').pop() ?? ''
    const contentType = req.headers['content-type'] ?? ''
    const multipart = contentType.startsWith('multipart/')
    const body = await read(req)
    const params = multipart ? await formFields(body, contentType) : body.length ? JSON.parse(body.toString()) : {}
    calls.push({ method, params, multipart })
    const reply = await (handlers[method] ?? (() => true))(params)
    if (isRaw(reply)) return void res.writeHead(reply.httpStatus).end(reply.raw)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(toEnvelope(reply)))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${port}`,
    calls,
    handlers,
    named: (method: string) => calls.filter(c => c.method === method),
    close: () => new Promise<void>(resolve => (server.close(() => resolve()), server.closeAllConnections())),
  }
}

/** A reply that is not a Bot API envelope, e.g. a gateway's HTML error page. */
export type RawReply = { httpStatus: number; raw: string }

function isRaw(reply: Reply): reply is RawReply {
  return Boolean(reply && typeof reply === 'object' && 'httpStatus' in reply)
}

function toEnvelope(reply: Reply) {
  if (reply && typeof reply === 'object' && 'error_code' in reply) {
    const { error_code, description, retry_after } = reply as { error_code: number; description: string; retry_after?: number }
    return { ok: false, error_code, description, parameters: retry_after === undefined ? undefined : { retry_after } }
  }
  return { ok: true, result: reply }
}

async function read(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** The text fields of an upload (files left out), JSON values parsed back. */
async function formFields(body: Buffer, contentType: string): Promise<Record<string, unknown>> {
  const form = await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData()
  const fields: Record<string, unknown> = {}
  for (const [key, value] of form) if (typeof value === 'string') fields[key] = parseJson(value)
  return fields
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
