import { createWriteStream } from 'node:fs'
import { access, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { Paths } from '../daemon/paths.ts'
import { confirm } from './prompt.ts'
import { has, runLive } from './shell.ts'
import { note, ok, paint, progress } from './ui.ts'

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
  if (formulas.length === 0 && status.model) return ok('Voice transcription ready (ffmpeg + whisper-cpp + model)')
  describeMissing(status, formulas)
  if (!(await confirm('  Install them now?', assumeYes))) return note('Skipped. Voice will arrive as files without transcripts.')
  if (formulas.length) await brewInstall(formulas)
  if (!status.model) await downloadModel(status.modelPath)
  ok('Voice transcription ready')
}

function missingFormulas(status: VoiceStatus): string[] {
  return [status.ffmpeg ? '' : 'ffmpeg', status.whisper ? '' : 'whisper-cpp'].filter(Boolean)
}

function describeMissing(status: VoiceStatus, formulas: string[]): void {
  note('Voice messages get transcripts when these are installed:')
  for (const formula of formulas) item(formula, 'Homebrew')
  if (!status.model) item('whisper model', `~142 MB → ${status.modelPath}`)
}

function item(what: string, detail: string): void {
  note(`  • ${paint('bold', what)}  ${detail}`)
}

async function brewInstall(formulas: string[]): Promise<void> {
  note(`$ brew install ${formulas.join(' ')}   (Homebrew prints its own progress; a few minutes is normal)`)
  await runLive('brew', ['install', ...formulas])
  ok(`Installed ${formulas.join(', ')}`)
}

async function downloadModel(dest: string): Promise<void> {
  await mkdir(join(dest, '..'), { recursive: true })
  const response = await fetch(MODEL_URL)
  if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`)
  const show = progress('whisper model', Number(response.headers.get('content-length')))
  let done = 0
  await pipeline(
    Readable.fromWeb(response.body as NodeReadableStream),
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        show((done += chunk.length))
        yield chunk
      }
    },
    createWriteStream(`${dest}.part`),
  )
  await rename(`${dest}.part`, dest)
  ok('Whisper model downloaded')
}
