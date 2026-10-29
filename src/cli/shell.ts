import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Runs a command, resolving its stdout; rejects with its stderr on failure. */
export async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/** Runs a long command with its output on the screen, so the person sees it work. */
export function runLive(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))))
  })
}

export async function has(command: string): Promise<boolean> {
  return run('which', [command]).then(
    () => true,
    () => false,
  )
}
