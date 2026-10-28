import { createWriteStream, openAsBlob } from 'node:fs'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { setTimeout as sleep } from 'node:timers/promises'

const MAX_RETRIES = 3

type Envelope<T> = { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } }
type CallOptions = { signal?: AbortSignal }

export type Api = {
  call<T>(method: string, params?: object, options?: CallOptions): Promise<T>
  upload<T>(method: string, params: object, files: Record<string, string>): Promise<T>
  download(fileId: string, dir: string, name?: string): Promise<string>
}

/** A Bot API failure. The message never contains the token-bearing URL. */
export class TelegramError extends Error {
  readonly status: number
  readonly retryAfter?: number

  constructor(status: number, description: string, retryAfter?: number) {
    super(description)
    this.status = status
    this.retryAfter = retryAfter
  }
}

type ApiOptions = { token: string; base?: string; retryDelayMs?: number }

export function createApi({ token, base = 'https://api.telegram.org', retryDelayMs = 1000 }: ApiOptions): Api {
  const methodUrl = (method: string) => `${base}/bot${token}/${method}`

  /** Retries 429 (after retry_after), 5xx and dropped connections; anything else is the caller's problem. */
  async function send<T>(method: string, init: () => Promise<RequestInit>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const request = await init()
      try {
        return await sendOnce<T>(method, request)
      } catch (error) {
        if (attempt >= MAX_RETRIES || request.signal?.aborted || !isTransient(error)) throw error
        await sleep(error instanceof TelegramError && error.retryAfter !== undefined ? error.retryAfter * 1000 : retryDelayMs * 2 ** attempt)
      }
    }
  }

  async function sendOnce<T>(method: string, request: RequestInit): Promise<T> {
    const response = await fetch(methodUrl(method), { method: 'POST', ...request })
    const envelope = (await response.json().catch(() => ({ ok: false }))) as Envelope<T>
    if (envelope.ok) return envelope.result as T
    const description = envelope.description ?? `Telegram answered HTTP ${response.status}`
    throw new TelegramError(envelope.error_code ?? response.status, description, envelope.parameters?.retry_after)
  }

  return {
    call: (method, params = {}, options = {}) =>
      send(method, async () => ({
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: options.signal,
      })),
    upload: (method, params, files) => send(method, async () => ({ body: await toForm(params, files) })),
    async download(fileId, dir, name) {
      const file = await this.call<{ file_path: string }>('getFile', { file_id: fileId })
      const response = await fetch(`${base}/file/bot${token}/${file.file_path}`)
      if (!response.ok || !response.body) throw new TelegramError(response.status, 'File download failed')
      const path = join(dir, name ?? basename(file.file_path))
      await pipeline(Readable.fromWeb(response.body as NodeReadableStream), createWriteStream(path))
      return path
    },
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof TelegramError) return error.status === 429 || error.status >= 500
  return error instanceof TypeError // fetch: connection refused, reset or DNS failure
}

async function toForm(params: object, files: Record<string, string>): Promise<FormData> {
  const form = new FormData()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  for (const [field, path] of Object.entries(files)) form.append(field, await openAsBlob(path), basename(path))
  return form
}
