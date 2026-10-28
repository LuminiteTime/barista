import { createWriteStream } from 'node:fs'
import { access, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { Paths } from '../daemon/paths.ts'
import { confirm, say } from './prompt.ts'
import { has, run } from './shell.ts'

export const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'

export type VoiceStatus = { ffmpeg: boolean; whisper: boolean; model: boolean; modelPath: string }

export async function voiceStatus(paths: Paths): Promise<VoiceStatus> {
  const modelPath = join(paths.models, 'ggml-base.bin')
  const model = await access(modelPath).then(() => true, () => false)
  return { ffmpeg: await has('ffmpeg'), whisper: await has('whisper-cli'), model, modelPath }
}

/** Voice messages need ffmpeg + whisper-cpp + a model; offers to install whatever is missing. */
export async function setupVoice(paths: Paths, assumeYes: boolean): Promise<void> {
  const status = await voiceStatus(paths)
  const formulas = missingFormulas(status)
  if (formulas.length === 0 && status.model) return say('✓ Voice transcription ready (ffmpeg + whisper-cpp)')
  describeMissing(status, formulas)
  if (!(await confirm('Install them now?', assumeYes))) return say('Skipped. Voice will arrive as files without transcripts.')
  if (formulas.length) await run('brew', ['install', ...formulas])
  if (!status.model) await downloadModel(status.modelPath)
  say('✓ Voice transcription ready')
}

function missingFormulas(status: VoiceStatus): string[] {
  return [status.ffmpeg ? '' : 'ffmpeg', status.whisper ? '' : 'whisper-cpp'].filter(Boolean)
}

function describeMissing(status: VoiceStatus, formulas: string[]): void {
  say('Voice messages need: ' + [...formulas, status.model ? '' : 'whisper model (~142 MB)'].filter(Boolean).join(', '))
  if (formulas.length) say(`  brew install ${formulas.join(' ')}`)
  if (!status.model) say(`  curl -L -o ${status.modelPath} ${MODEL_URL}`)
}

async function downloadModel(dest: string): Promise<void> {
  await mkdir(join(dest, '..'), { recursive: true })
  const response = await fetch(MODEL_URL)
  if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`)
  say('Downloading whisper model…')
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream), createWriteStream(`${dest}.part`))
  await rename(`${dest}.part`, dest)
}
