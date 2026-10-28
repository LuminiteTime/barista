import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Runs a command, resolving its stdout; rejects with its stderr on failure. */
export async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

export async function has(command: string): Promise<boolean> {
  return run('which', [command]).then(
    () => true,
    () => false,
  )
}
