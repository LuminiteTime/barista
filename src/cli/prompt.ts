import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

export async function ask(question: string, terminal = process.stdout.isTTY): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

/** Like ask, but the answer is not echoed, so a token stays off the screen and out of scrollback. */
export async function askSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) return ask(question)
  spawnSync('stty', ['-echo'], { stdio: 'inherit' })
  try {
    return await ask(question, false)
  } finally {
    spawnSync('stty', ['echo'], { stdio: 'inherit' })
    say()
  }
}

export async function confirm(question: string, assumeYes = false): Promise<boolean> {
  if (assumeYes) return true
  return /^y(es)?$/i.test(await ask(`${question} [y/N] `))
}

export function say(line = ''): void {
  process.stdout.write(line + '\n')
}
