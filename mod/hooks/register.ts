import type { On, Register } from 'claude-code'
import { attach, bindSession, createBridge, endSession, finishTurn, pollOnce, showStatus, startTurn, unbindSession, type Bridge } from './bridge.ts'
import { explain } from './client.ts'
import { INSTRUCTIONS, parseBindArgs } from './format.ts'
import type { Io } from './io.ts'
import { closePermissionNotice, closePermissionNotices, openPermissionNotice, trackCall } from './permissions.ts'
import { startRemoteControl } from './remote.ts'
import { runTool, TOOL_PATTERN, TOOLS } from './tools.ts'

type Mod = { bridge: Bridge; io?: Io }

const POLL_EVERY_MS = 1_000
const STARTING = 'barista is starting…'
const USAGE = 'Usage: /tg bind <chat> [/ <topic>] [--create] [--force] · /tg unbind · /tg status'

export const register: Register = on => {
  const mod: Mod = { bridge: createBridge() }
  hookSession(on, mod)
  hookCommandsAndTools(on, mod)
  hookPermissions(on, mod)
  hookTurns(on, mod)
}

function hookSession(on: On, mod: Mod): void {
  on('session.start', async ($, e, next) => {
    const io: Io = {
      fetch: (url, init) => $.http.fetch(url, init),
      baristaHome: async () => (await $.env.get('BARISTA_HOME')) ?? `${await $.env.get('HOME')}/.barista`,
      sessionId: () => $.session.id(),
      status: text => $.ui.status(text),
      toast: text => $.ui.toast(text),
      submit: async text => ({ isDropped: (await $.prompt.submit({ text, asUser: true })).drop !== undefined }),
      abortTurn: turnId => $.turn.abort({ turnId }),
      after: (ms, fn) => void $.clock.after(ms, fn),
      commandNames: async () => (await $.command.list()).map(c => c.name),
      runCommand: async name => (await $.command.run({ command: name, args: '' })).text,
    }
    mod.io = io
    await $.command.register({ name: 'tg', description: 'Bind this session to Telegram: /tg bind <chat> / <topic>', argumentHint: 'bind|unbind|status' })
    for (const { name, description, inputSchema } of TOOLS) await $.tool.register({ name, description, inputSchema, isDeferred: false })
    await attach(io, mod.bridge).catch(error => showStatus(io, mod.bridge, error))
    $.clock.every(POLL_EVERY_MS, () => void pollOnce(io, mod.bridge))
    return next(e)
  })

  on('session.end', async (_$, e, next) => {
    if (mod.io) {
      await closePermissionNotices(mod.io, mod.bridge, false)
      await endSession(mod.io, mod.bridge)
    }
    return next(e)
  })
}

function hookCommandsAndTools(on: On, mod: Mod): void {
  on('command.run', { command: 'tg' }, async (_$, e) => ({ text: mod.io ? await runCommand(mod.io, mod.bridge, e.args) : STARTING }))

  on('tool.call', { tool: TOOL_PATTERN }, async (_$, e) => ({
    result: mod.io ? await runTool(mod.io, mod.bridge, e.tool, e as Record<string, unknown>) : STARTING,
  })).catch(() => ({ result: 'barista failed unexpectedly; see `barista doctor`.' }))

  on('prompt.compose', async (_$, e, next) => {
    const result = await next(e)
    const binding = mod.bridge.binding
    if (!binding) return result
    return { ...result, sections: [...result.sections, { id: 'barista', text: INSTRUCTIONS(binding.title), scope: 'session' as const }] }
  })
}

function hookPermissions(on: On, mod: Mod): void {
  on('classic.PermissionRequest', async (_$, e, next) => {
    if (mod.io) await openPermissionNotice(mod.io, mod.bridge, e.tool_name, e.tool_input)
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('tool.call', async (_$, e, next) => {
    trackCall(mod.bridge, e.tool_use_id, e.tool)
    try {
      return await next(e)
    } finally {
      if (mod.io) await closePermissionNotice(mod.io, mod.bridge, e.tool_use_id)
    }
  }).catch((_$, e, next) => next(e))
}

function hookTurns(on: On, mod: Mod): void {
  on('turn.start', async (_$, e, next) => {
    if (mod.io && e.agentId === undefined) await startTurn(mod.io, mod.bridge, e.turnId, e.text)
    return next(e)
  })

  on('turn.complete', async (_$, e, next) => {
    const result = await next(e)
    if (mod.io && e.agentId === undefined) {
      await closePermissionNotices(mod.io, mod.bridge, false)
      await finishTurn(mod.io, mod.bridge, e.reason, e.answer)
    }
    return result
  })
}

async function runCommand(io: Io, bridge: Bridge, args: string): Promise<string> {
  const [verb, ...rest] = args.trim().split(/\s+/)
  try {
    if (verb === 'unbind') return await unbindSession(io, bridge)
    if (verb === 'status' || verb === '') return bridge.binding ? `Bound to ${bridge.binding.title}.` : `Not bound. ${USAGE}`
    const parsed = verb === 'bind' ? parseBindArgs(rest.join(' ')) : undefined
    if (!parsed) return USAGE
    const text = await bindSession(io, bridge, parsed)
    startRemoteControl(io, bridge)
    return text
  } catch (error) {
    return `✗ ${explain(error)}`
  }
}
