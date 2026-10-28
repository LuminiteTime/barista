/** Telegram's rich-message cap (Bot API 10.1). */
export const RICH_MESSAGE_LIMIT = 32768

/** Splits text into chunks ≤ limit: by paragraph, then line, then a hard cut. Fenced code stays whole when it fits. */
export function splitText(text: string, limit = RICH_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const pieces = paragraphs(text).flatMap(p => (p.length <= limit ? [p] : splitLines(p, limit)))
  return pack(pieces, '\n\n', limit)
}

function paragraphs(text: string): string[] {
  const result: string[] = []
  let current: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence
    if (line === '' && !inFence) {
      if (current.length) result.push(current.join('\n'))
      current = []
    } else current.push(line)
  }
  if (current.length) result.push(current.join('\n'))
  return result
}

function splitLines(paragraph: string, limit: number): string[] {
  const lines = paragraph.split('\n').flatMap(line => hardCut(line, limit))
  return pack(lines, '\n', limit)
}

function hardCut(line: string, limit: number): string[] {
  const parts: string[] = []
  for (let i = 0; i < line.length; i += limit) parts.push(line.slice(i, i + limit))
  return parts.length ? parts : ['']
}

function pack(pieces: string[], separator: string, limit: number): string[] {
  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    const joined = current ? current + separator + piece : piece
    if (joined.length <= limit) current = joined
    else {
      if (current) chunks.push(current)
      current = piece
    }
  }
  if (current) chunks.push(current)
  return chunks
}
