import type { InboundMessage } from './protocol.ts'

/** The prompt Claude reads for a Telegram message: one header line, then the content. */
export function toPrompt(message: InboundMessage): string {
  const lines = [message.header]
  if (message.text) lines.push(message.text)
  if (message.replyTo) lines.push(`↪ in reply to: "${message.replyTo}"`)
  for (const file of message.files) lines.push(`📎 ${file}`)
  if (message.transcript) lines.push(`🎙 transcript: ${message.transcript}`)
  if (message.note) lines.push(`⚠ ${message.note}`)
  return lines.join('\n')
}

export type BindArgs = { chat: string; topic?: string; create: boolean; force: boolean }

/** Parses `<chat> [/ <topic>] [--create] [--force]`. */
export function parseBindArgs(input: string): BindArgs | undefined {
  const create = /(^|\s)--create\b/.test(input)
  const force = /(^|\s)--force\b/.test(input)
  const rest = input.replace(/(^|\s)--(create|force)\b/g, ' ').trim()
  if (!rest) return undefined
  const slash = rest.indexOf(' / ')
  if (slash < 0) return { chat: unquote(rest), create, force }
  return { chat: unquote(rest.slice(0, slash)), topic: unquote(rest.slice(slash + 3)), create, force }
}

/** People quote names with spaces out of shell habit; titles never start and end with quotes. */
function unquote(name: string): string {
  return name.trim().replace(/^["'«“](.*)["'»”]$/, '$1').trim()
}

/** `chat / topic`, as the person wrote it. */
export function bindTarget({ chat, topic }: BindArgs): string {
  return topic ? `${chat} / ${topic}` : chat
}

export const INSTRUCTIONS = (title: string) => `This session is bound to the Telegram chat "${title}" through barista.
- Prompts that start with "[Telegram · …]" come from the owner's phone. Treat them exactly like terminal prompts.
- The final answer of every turn is mirrored to that chat automatically. Write it in Markdown as usual; never call a tool just to send text.
- To send files (screenshots, videos, logs, documents), call mcp__barista__telegram_send_files with absolute paths. Prefer it whenever a picture or file shows the result better than words.
- Lines starting with 📎 are files the owner sent, already on disk: open images with Read.
- Keep answers phone-friendly: lead with the result, short paragraphs.`
