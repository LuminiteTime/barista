import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from './shell.ts'

export const LABEL = 'dev.barista.daemon'
export const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const DOMAIN = `gui/${process.getuid?.() ?? 501}`
const SERVICE_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

type PlistArgs = { node: string; script: string; home: string; log: string }

/** launchd keeps the daemon alive across crashes and logins. */
export function renderPlist({ node, script, home, log }: PlistArgs): string {
  const args = [node, script, 'daemon'].map(a => `    <string>${escape(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BARISTA_HOME</key><string>${escape(home)}</string>
    <key>PATH</key><string>${SERVICE_PATH}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escape(log)}</string>
  <key>StandardErrorPath</key><string>${escape(log)}</string>
</dict>
</plist>
`
}

export async function installService(args: PlistArgs): Promise<void> {
  await mkdir(dirname(PLIST), { recursive: true })
  await writeFile(PLIST, renderPlist(args))
  await stopService()
  await run('launchctl', ['bootstrap', DOMAIN, PLIST])
}

export async function stopService(): Promise<void> {
  await run('launchctl', ['bootout', `${DOMAIN}/${LABEL}`]).catch(() => undefined)
}

export async function startService(): Promise<void> {
  await run('launchctl', ['bootstrap', DOMAIN, PLIST]).catch(() => undefined)
  await run('launchctl', ['kickstart', '-k', `${DOMAIN}/${LABEL}`])
}

export async function removeService(): Promise<void> {
  await stopService()
  await unlink(PLIST).catch(() => undefined)
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
