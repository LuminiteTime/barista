import { styleText } from 'node:util'
import { say } from './prompt.ts'

type Color = 'green' | 'red' | 'yellow' | 'cyan' | 'gray' | 'bold'

/** styleText drops the colors when stdout is not a terminal or NO_COLOR is set. */
export const paint = (color: Color, text: string): string => styleText(color, text)

const live = Boolean(process.stdout.isTTY)
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function banner(): void {
  say(paint('yellow', '      ( (     '))
  say(paint('yellow', '       ) )    ') + paint('bold', 'barista'))
  say(paint('yellow', '    ._____.   ') + paint('gray', 'Claude Code ⇄ Telegram'))
  say(paint('yellow', '    |     |]  '))
  say(paint('yellow', "    \\     /   "))
  say(paint('yellow', "     `---'    "))
}

export function step(index: number, total: number, title: string): void {
  say(`\n${paint('cyan', `[${index}/${total}]`)} ${paint('bold', title)}`)
}

export const ok = (text: string): void => say(`  ${paint('green', '✓')} ${text}`)
export const fail = (text: string): void => say(`  ${paint('red', '✗')} ${text}`)
export const note = (text: string): void => say(`  ${paint('gray', text)}`)

/** Shows a spinner with the elapsed seconds while work runs, so a slow step never looks frozen. */
export async function spin<T>(label: string, work: Promise<T>): Promise<T> {
  if (!live) {
    note(`… ${label}`)
    return work
  }
  const started = Date.now()
  let frame = 0
  const draw = () => {
    const seconds = Math.floor((Date.now() - started) / 1000)
    process.stdout.write(`\r  ${paint('cyan', SPINNER[frame++ % SPINNER.length])} ${label} ${paint('gray', `${seconds}s`)}`)
  }
  draw()
  const timer = setInterval(draw, 80)
  try {
    return await work
  } finally {
    clearInterval(timer)
    process.stdout.write('\r\x1b[2K')
  }
}

/** A download bar redrawn in place; prints nothing outside a terminal. */
export function progress(label: string, total: number): (done: number) => void {
  const MB = 1024 * 1024
  let shown = -1
  return done => {
    const percent = total ? Math.floor((done / total) * 100) : 0
    if (!live || percent === shown) return
    shown = percent
    const filled = Math.round(percent / 4)
    const bar = paint('green', '█'.repeat(filled)) + paint('gray', '░'.repeat(25 - filled))
    process.stdout.write(`\r  ${label} ${bar} ${percent}% ${paint('gray', `${Math.round(done / MB)}/${Math.round(total / MB)} MB`)}`)
    if (done >= total) process.stdout.write('\n')
  }
}
