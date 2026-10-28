#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { runDaemon } from '../daemon/main.ts'
import { paths } from '../daemon/paths.ts'
import { doctor } from './doctor.ts'
import { removeService, startService, stopService } from './launchd.ts'
import { say } from './prompt.ts'
import { run } from './shell.ts'
import { setup } from './setup.ts'
import { callDaemon } from './socket.ts'

const USAGE = `barista — Claude Code ⇄ Telegram

  barista setup [--token T] [--owner ID] [--chats ID,ID] [--yes] [--no-voice] [--no-mod]
  barista doctor        check every prerequisite and say how to fix it
  barista status        daemon health and session bindings
  barista logs          follow the daemon log
  barista start|stop    control the launchd agent
  barista uninstall [--purge]
  barista daemon        run the daemon in the foreground (launchd uses this)`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    token: { type: 'string' },
    owner: { type: 'string' },
    chats: { type: 'string' },
    yes: { type: 'boolean', default: false },
    'no-voice': { type: 'boolean', default: false },
    'no-mod': { type: 'boolean', default: false },
    purge: { type: 'boolean', default: false },
  },
})

const p = paths()
const commands: Record<string, () => Promise<unknown>> = {
  setup: () =>
    setup(p, {
      token: values.token,
      owner: values.owner ? Number(values.owner) : undefined,
      chats: values.chats?.split(',').map(Number),
      yes: values.yes,
      voice: !values['no-voice'],
      mod: !values['no-mod'],
    }),
  doctor: async () => process.exit((await doctor(p)) ? 0 : 1),
  status: () => status(),
  logs: () => new Promise(() => spawn('tail', ['-n', '100', '-f', p.log], { stdio: 'inherit' })),
  start: () => startService().then(() => say('✓ started')),
  stop: () => stopService().then(() => say('✓ stopped')),
  uninstall: () => uninstall(values.purge),
  daemon: () => runDaemon(),
}

async function status(): Promise<void> {
  const health = await callDaemon(p.socket, 'GET', '/health').catch(() => undefined)
  if (!health) return say('✗ daemon not running → barista start   (details: barista doctor)')
  say(JSON.stringify(health.body))
  const bindings = (await callDaemon(p.socket, 'GET', '/bindings')).body as { title: string; sessionId: string; isLive: boolean }[]
  for (const b of bindings) say(`${b.isLive ? '●' : '○'} ${b.title}  ← session ${b.sessionId}`)
}

async function uninstall(purge: boolean): Promise<void> {
  await removeService()
  await run('claude', ['plugin', 'uninstall', 'barista@barista']).catch(() => undefined)
  if (purge) await rm(p.home, { recursive: true, force: true })
  say(`✓ barista removed${purge ? ' with its data' : `; data kept in ${p.home} (use --purge to delete)`}`)
}

const command = commands[positionals[0] ?? '']
if (!command) say(USAGE)
else
  await command().catch(error => {
    say(`✗ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
