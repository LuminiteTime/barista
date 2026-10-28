import type { MessageEntity } from '../telegram/types.ts'

type Node = { entity?: MessageEntity; start: number; end: number; children: Node[] }

const WRAPPERS: Record<string, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strikethrough: ['~~', '~~'],
  spoiler: ['||', '||'],
  code: ['`', '`'],
}

/** Renders Telegram text + entities as Markdown that Claude reads naturally. */
export function entitiesToMarkdown(text: string, entities: MessageEntity[] = []): string {
  return render(text, buildTree(text.length, entities))
}

function buildTree(length: number, entities: MessageEntity[]): Node {
  const root: Node = { start: 0, end: length, children: [] }
  const sorted = [...entities].sort((a, b) => a.offset - b.offset || b.length - a.length)
  const stack = [root]
  for (const entity of sorted) {
    const node: Node = { entity, start: entity.offset, end: entity.offset + entity.length, children: [] }
    while (stack.length > 1 && node.start >= stack[stack.length - 1].end) stack.pop()
    const parent = stack[stack.length - 1]
    node.end = Math.min(node.end, parent.end)
    parent.children.push(node)
    stack.push(node)
  }
  return root
}

function render(text: string, node: Node): string {
  let out = ''
  let pos = node.start
  for (const child of node.children) {
    out += text.slice(pos, child.start) + render(text, child)
    pos = child.end
  }
  out += text.slice(pos, node.end)
  return node.entity ? wrap(node.entity, out) : out
}

function wrap(entity: MessageEntity, inner: string): string {
  const pair = WRAPPERS[entity.type]
  if (pair) return pair[0] + inner + pair[1]
  switch (entity.type) {
    case 'pre':
      return '```' + (entity.language ?? '') + '\n' + inner + '\n```'
    case 'text_link':
      return `[${inner}](${entity.url})`
    case 'blockquote':
    case 'expandable_blockquote':
      return inner.replace(/^/gm, '> ')
    default:
      return inner
  }
}
