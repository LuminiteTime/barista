import type { ErrorBody, ErrorCode } from '../../mod/hooks/protocol.ts'

/** An error the user can act on: what failed and what to do about it. */
export class BaristaError extends Error {
  readonly code: ErrorCode
  readonly hint?: string

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message)
    this.code = code
    this.hint = hint
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, hint: this.hint } }
  }
}
