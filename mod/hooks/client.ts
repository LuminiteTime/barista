import type { Io } from './io.ts'
import type { ErrorBody, ErrorCode } from './protocol.ts'

/** A daemon refusal, carrying what the user should do next. */
export class DaemonError extends Error {
  readonly code: ErrorCode
  readonly hint?: string

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message)
    this.code = code
    this.hint = hint
  }

  explain(): string {
    return `${this.code}: ${this.message}${this.hint ? ` → ${this.hint}` : ''}`
  }
}

export async function socketPath(io: Io): Promise<string> {
  return `${await io.baristaHome()}/barista.sock`
}

/** One JSON call to the barista daemon over its unix socket. */
export async function callDaemon<T>(io: Io, method: string, path: string, body?: object): Promise<T> {
  const response = await io
    .fetch(`http://barista${path}`, {
      method,
      socketPath: await socketPath(io),
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    .catch(() => {
      throw new DaemonError('DAEMON_DOWN', 'The barista daemon is not reachable.', 'Run `barista start` (or `barista doctor`).')
    })
  const parsed = parse(response.text)
  if (response.ok) return parsed as T
  const error = (parsed as Partial<ErrorBody>).error
  if (!error) throw new DaemonError('INTERNAL', `The daemon answered HTTP ${response.status}.`, 'See: barista logs')
  throw new DaemonError(error.code, error.message, error.hint)
}

function parse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

export function explain(error: unknown): string {
  return error instanceof DaemonError ? error.explain() : `INTERNAL: ${error instanceof Error ? error.message : String(error)}`
}
