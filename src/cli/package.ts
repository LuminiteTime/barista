import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The installed package's root (holds package.json, mod/ and .claude-plugin/), in dev and from dist alike. */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!isBaristaRoot(dir)) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Cannot find the barista package root.')
    dir = parent
  }
  return dir
}

/** The CLI entry launchd should run: this very file's sibling main, resolved through npm's bin symlink. */
export function cliEntry(): string {
  return realpathSync(process.argv[1])
}

export function version(): string {
  return JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')).version
}

function isBaristaRoot(dir: string): boolean {
  const manifest = join(dir, 'package.json')
  return existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'barista'
}
