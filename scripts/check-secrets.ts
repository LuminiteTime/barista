// Fails when a file about to be committed holds a secret, so none reaches the public repository.
// It checks two lists: SHAPES, what any secret looks like (checked everywhere, CI included), and
// .secrets.local, gitignored, one value per line that is yours alone: your Telegram id, bot username,
// chat titles. Findings name the file, the line and the kind, never the value.
//
//   node scripts/check-secrets.ts            the tracked files as they are on disk (npm run check)
//   node scripts/check-secrets.ts --staged   what the next commit holds (the pre-commit hook)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

export type SourceFile = { path: string; text: string }
export type Finding = { path: string; line: number; what: string }

const LOCAL_VALUES = '.secrets.local'
const SHAPES: [string, RegExp][] = [
  ['Telegram bot token', /\b\d{8,10}:[\w-]{35}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]

export function findSecrets(files: SourceFile[], localValues: string[]): Finding[] {
  const values = localValues.map(v => v.trim().toLowerCase()).filter(Boolean)
  return files.flatMap(({ path, text }) =>
    text.split('\n').flatMap((content, index) => {
      const line = index + 1
      const shapes = SHAPES.filter(([, shape]) => shape.test(content)).map(([what]) => ({ path, line, what }))
      const lower = content.toLowerCase()
      const own = values.flatMap((value, n) => (lower.includes(value) ? [{ path, line, what: `${LOCAL_VALUES} value #${n + 1}` }] : []))
      return [...shapes, ...own]
    }),
  )
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function filesToCommit(isStaged: boolean): SourceFile[] {
  const listed = isStaged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z') : git('ls-files', '-z')
  return listed
    .split('\0')
    .filter(path => path && path !== LOCAL_VALUES && (isStaged || existsSync(path)))
    .map(path => ({ path, text: isStaged ? git('show', `:${path}`) : readFileSync(path, 'utf8') }))
    .filter(file => !file.text.includes('\0')) // binary
}

function main(): void {
  const localValues = existsSync(LOCAL_VALUES) ? readFileSync(LOCAL_VALUES, 'utf8').split('\n') : []
  const found = findSecrets(filesToCommit(process.argv.includes('--staged')), localValues)
  for (const { path, line, what } of found) console.error(`✗ ${path}:${line}  ${what}`)
  if (found.length) {
    console.error('\nRemove these before committing; real secrets live in ~/.barista/config.json, test data uses made-up values.')
    process.exit(1)
  }
}

if (import.meta.main) main()
