/**
 * What barista needs from Claude Code. The mod engine only allows `$` to be
 * spelled at its call sites, so register.ts builds this port once and the rest
 * of the mod depends on it — which also makes the logic testable without the engine.
 */
import type { Band } from './status.ts'

export type HttpInit = { method?: string; headers?: Record<string, string>; body?: string; socketPath?: string }
export type HttpResponse = { status: number; ok: boolean; text: string }

export type Io = {
  fetch(url: string, init: HttpInit): Promise<HttpResponse>
  /** ~/.barista, or $BARISTA_HOME. */
  baristaHome(): Promise<string>
  sessionId(): Promise<string>
  /** Redraws the barista band above the prompt. */
  status(band: Band): void
  toast(text: string): void
  submit(text: string): Promise<{ isDropped: boolean }>
  abortTurn(turnId: string): Promise<void>
  after(ms: number, fn: () => void): void
}
