import { chmod, unlink } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { BaristaError } from './errors.ts'
import { log } from './log.ts'
import { TelegramError } from './telegram/api.ts'

export type Request = { body: Record<string, unknown>; query: URLSearchParams; signal: AbortSignal }
export type Handler = (request: Request) => Promise<unknown> | unknown
export type Routes = Record<string, Handler>

/** JSON over HTTP on a unix socket. Routes are keyed "METHOD /path". */
export async function serve(socketPath: string, routes: Routes): Promise<Server> {
  await unlink(socketPath).catch(() => undefined)
  const server = createServer((req, res) => void handle(routes, req, res))
  await new Promise<void>(resolve => server.listen(socketPath, resolve))
  await chmod(socketPath, 0o600)
  return server
}

async function handle(routes: Routes, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://barista')
  const handler = routes[`${req.method} ${url.pathname}`]
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  try {
    if (!handler) throw new BaristaError('BAD_REQUEST', `No route ${req.method} ${url.pathname}.`)
    const result = await handler({ body: await readJson(req), query: url.searchParams, signal: controller.signal })
    reply(res, 200, result ?? { ok: true })
  } catch (error) {
    const failure = toFailure(error)
    if (failure.error.code === 'INTERNAL') log('error', `${req.method} ${url.pathname} failed`, error)
    reply(res, failure.error.code === 'INTERNAL' ? 500 : 400, failure)
  }
}

function toFailure(error: unknown) {
  if (error instanceof BaristaError) return error.toBody()
  if (error instanceof TelegramError) return new BaristaError('TG_API', `Telegram: ${error.message}`).toBody()
  return new BaristaError('INTERNAL', 'The daemon hit an unexpected error.', 'See: barista logs').toBody()
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of req) text += chunk
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new BaristaError('BAD_REQUEST', 'Body is not JSON.')
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}
