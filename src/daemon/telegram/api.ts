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
  download(fileId: string, dir: string): Promise<string>
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

export function createApi({ token, base = 'https://api.telegram.org' }: { token: string; base?: string }): Api {
  const methodUrl = (method: string) => `${base}/bot${token}/${method}`

  async function send<T>(method: string, init: () => Promise<RequestInit>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(methodUrl(method), { method: 'POST', ...(await init()) })
      const envelope = (await response.json()) as Envelope<T>
      if (envelope.ok) return envelope.result as T
      const error = new TelegramError(envelope.error_code ?? response.status, envelope.description ?? 'Unknown error', envelope.parameters?.retry_after)
      if (error.status !== 429 || attempt >= MAX_RETRIES) throw error
      await sleep((error.retryAfter ?? 1) * 1000)
    }
  }

  return {
    call: (method, params = {}, options = {}) =>
      send(method, async () => ({
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: options.signal,
      })),
    upload: (method, params, files) => send(method, async () => ({ body: await toForm(params, files) })),
    async download(fileId, dir) {
      const file = await this.call<{ file_path: string }>('getFile', { file_id: fileId })
      const response = await fetch(`${base}/file/bot${token}/${file.file_path}`)
      if (!response.ok || !response.body) throw new TelegramError(response.status, 'File download failed')
      const path = join(dir, basename(file.file_path))
      await pipeline(Readable.fromWeb(response.body as NodeReadableStream), createWriteStream(path))
      return path
    },
  }
}

async function toForm(params: object, files: Record<string, string>): Promise<FormData> {
  const form = new FormData()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  for (const [field, path] of Object.entries(files)) form.append(field, await openAsBlob(path), basename(path))
  return form
}
