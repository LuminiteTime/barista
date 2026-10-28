import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export type Run = (command: string, args: string[]) => Promise<string>

const execFileAsync = promisify(execFile)
const TIMEOUT_MS = 120_000

export const runCommand: Run = async (command, args) =>
  (await execFileAsync(command, args, { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })).stdout

/** Voice/audio → text via ffmpeg + whisper-cpp. Undefined when anything is missing or fails. */
export async function transcribe(audioPath: string, modelPath: string, run: Run = runCommand): Promise<string | undefined> {
  const wav = `${audioPath}.wav`
  try {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', audioPath, '-ar', '16000', '-ac', '1', wav])
    const text = await run('whisper-cli', ['-m', modelPath, '-f', wav, '-nt', '-np', '-l', 'auto'])
    return text.trim() || undefined
  } catch {
    return undefined
  }
}
