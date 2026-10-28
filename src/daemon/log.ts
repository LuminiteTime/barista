type Level = 'info' | 'warn' | 'error' | 'debug'

// ponytail: plain lines to stdout; launchd appends them to ~/.barista/daemon.log. No rotation: add it if the log ever grows large.
export function log(level: Level, message: string, detail?: unknown): void {
  if (level === 'debug' && !process.env.BARISTA_DEBUG) return
  const suffix = detail === undefined ? '' : ' ' + describe(detail)
  process.stdout.write(`${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}\n`)
}

function describe(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`
  return typeof detail === 'string' ? detail : JSON.stringify(detail)
}
