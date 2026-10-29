import type { Io } from './io.ts'
import { mirror, type Bridge } from './bridge.ts'
import { explain } from './client.ts'

const COMMAND_NAMES = ['remote-control', 'rc']
const URL = /https:\/\/\S+/

/** Starts Remote Control once bound, so permission questions can be answered from the phone app. */
export function startRemoteControl(io: Io, bridge: Bridge): void {
  // A slash command cannot run inside a hook the turn waits on; run it once the session is free.
  io.after(500, () => void runRemoteControl(io, bridge))
}

async function runRemoteControl(io: Io, bridge: Bridge): Promise<void> {
  try {
    // Once on, Remote Control stays on: a second run opens its panel instead, so a new binding only gets the link.
    if (!bridge.isRemoteOn) await runCommand(io, bridge)
    const url = bridge.remoteUrl
    await mirror(io, bridge, url ? `📱 Remote Control for this session: ${url}` : '📱 Remote Control is on for this session.')
  } catch (error) {
    const reason = explain(error)
    io.toast(`barista: Remote Control not started (${reason})`)
    await mirror(io, bridge, `⚠ Remote Control not started: ${reason}. Permission questions can only be answered in the terminal.`)
  }
}

async function runCommand(io: Io, bridge: Bridge): Promise<void> {
  const name = (await io.commandNames()).find(n => COMMAND_NAMES.includes(n))
  if (!name) throw new Error('this Claude Code has no /remote-control command')
  bridge.remoteUrl = (await io.runCommand(name))?.match(URL)?.[0]
  bridge.isRemoteOn = true
}
