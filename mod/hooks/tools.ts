import type { Io } from './io.ts'
import { replyTarget, unbindSession, type Bridge } from './bridge.ts'
import { callDaemon, explain } from './client.ts'
import type { SendFilesResult } from './protocol.ts'
import { describeStatus } from './status.ts'
import { bindOrWait } from './waiting.ts'

type Input = Record<string, unknown>

export const TOOL_PREFIX = 'mcp__barista__'
export const TOOL_PATTERN = /^mcp__barista__telegram_/

const FILE = {
  type: 'object',
  properties: { path: { type: 'string', description: 'Absolute path' }, caption: { type: 'string' } },
  required: ['path'],
}

/** The tools Claude calls; each returns a plain sentence it can relay. */
export const TOOLS = [
  {
    name: 'telegram_bind',
    description:
      'Bind this session to a Telegram chat or forum topic by name, so messages there arrive here and answers are mirrored back. Forum chats need a topic.',
    inputSchema: {
      type: 'object',
      properties: {
        chat: { type: 'string', description: 'Chat title, or "me" for the private chat with the bot' },
        topic: { type: 'string', description: 'Forum topic name (required for chats with topics)' },
        create: { type: 'boolean', description: 'Create the topic if it does not exist' },
        force: { type: 'boolean', description: 'Take the topic from another live session' },
      },
      required: ['chat'],
    },
    run: (io: Io, bridge: Bridge, input: Input) =>
      bindOrWait(io, bridge, { chat: String(input.chat), topic: input.topic as string | undefined, create: input.create === true, force: input.force === true }),
  },
  {
    name: 'telegram_unbind',
    description: 'Stop listening to Telegram in this session.',
    inputSchema: { type: 'object', properties: {} },
    run: (io: Io, bridge: Bridge) => unbindSession(io, bridge),
  },
  {
    name: 'telegram_send_files',
    description:
      'Send files to the bound Telegram chat: images and videos as an album, other files as documents. Text answers are mirrored automatically; use this only for files.',
    inputSchema: {
      type: 'object',
      properties: { files: { type: 'array', items: FILE, minItems: 1 }, caption: { type: 'string' } },
      required: ['files'],
    },
    run: async (io: Io, bridge: Bridge, input: Input) => {
      const request = { sessionId: bridge.sessionId, ...input, replyTo: replyTarget(bridge) }
      const { messageIds, skipped } = await callDaemon<SendFilesResult>(io, 'POST', '/send-files', request)
      const notSent = skipped.length ? ` Not sent: ${skipped.join(' ')}` : ''
      return `Sent ${messageIds.length} message(s) to ${bridge.binding?.title}.${notSent}`
    },
  },
  {
    name: 'telegram_status',
    description: 'Show whether this session is bound to Telegram, and where.',
    inputSchema: { type: 'object', properties: {} },
    run: (io: Io, bridge: Bridge) => describeStatus(io, bridge),
  },
]

export async function runTool(io: Io, bridge: Bridge, tool: string, input: Input): Promise<string> {
  const spec = TOOLS.find(t => TOOL_PREFIX + t.name === tool)
  if (!spec) return `Unknown tool ${tool}.`
  return spec.run(io, bridge, input).catch(error => `Failed: ${explain(error)}`)
}
