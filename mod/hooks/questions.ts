import type { Io } from './io.ts'
import type { Bridge } from './bridge.ts'
import { callDaemon } from './client.ts'
import type { NoticeButton } from './protocol.ts'

/** One question of the AskUserQuestion tool, as its input carries it. */
export type Question = { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect?: boolean }

/** A question set waiting in Telegram: what is picked so far, and who waits for the answers. */
export type Asking = { questions: Question[]; picked: Set<number>[]; isDone: boolean[]; resolve: (answers?: Record<string, string>) => void }

const DONE = 'done'

/**
 * Posts Claude's questions to Telegram with one button per option, and resolves with the answers once the
 * owner has picked one for each (multi-select: toggles, then Done). Resolves undefined when the question is
 * settled elsewhere (the terminal), see settleQuestions.
 */
export function askInTelegram(io: Io, bridge: Bridge, key: string, input: unknown): Promise<Record<string, string> | undefined> {
  const questions = ((input ?? {}) as { questions?: Question[] }).questions ?? []
  if (!bridge.binding || questions.length === 0) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const asking: Asking = { questions, picked: questions.map(() => new Set()), isDone: questions.map(() => false), resolve }
    bridge.asking.set(key, asking)
    // Kept as the notice's post, so the call ending first still finds and removes it.
    bridge.notices.set(key, post(io, bridge, key, asking).then(() => undefined, () => undefined))
  })
}

/** A button press from Telegram: `data` is `<question>:<option>` or `<question>:done`. */
export async function chooseInTelegram(io: Io, bridge: Bridge, key: string, data: string): Promise<void> {
  const asking = bridge.asking.get(key)
  const [q, choice] = data.split(':')
  const question = asking?.questions[Number(q)]
  if (!asking || !question) return
  pick(asking, Number(q), choice)
  if (asking.isDone.every(Boolean)) {
    bridge.asking.delete(key)
    return asking.resolve(answersOf(asking))
  }
  await post(io, bridge, key, asking)
}

/** Done closes a multi-select; an option toggles there, and answers a single-select question outright. */
function pick(asking: Asking, q: number, choice: string): void {
  const picked = asking.picked[q]
  const option = Number(choice)
  if (choice === DONE) asking.isDone[q] = picked.size > 0
  else if (!asking.questions[q].multiSelect) {
    picked.clear()
    picked.add(option)
    asking.isDone[q] = true
  } else if (picked.has(option)) picked.delete(option)
  else picked.add(option)
}

/** The question was answered in the terminal, or its call ended: stop waiting for Telegram. */
export function settleQuestions(bridge: Bridge, key: string): void {
  bridge.asking.get(key)?.resolve(undefined)
  bridge.asking.delete(key)
}

function post(io: Io, bridge: Bridge, key: string, asking: Asking): Promise<unknown> {
  return callDaemon(io, 'POST', '/notice', { sessionId: bridge.sessionId, key, text: render(asking), buttons: buttonsOf(asking) })
}

/** The questions as plain text; the options are on the buttons, their descriptions here. */
function render({ questions }: Asking): string {
  const blocks = questions.map(({ question, header, options, multiSelect }, n) => {
    const title = `${questions.length > 1 ? `${n + 1}. ` : ''}${header ? `${header}: ` : ''}${question}`
    const details = options.filter(o => o.description).map(o => `• ${o.label}: ${o.description}`)
    return [`❓ ${title}${multiSelect ? ' (pick any, then Done)' : ''}`, ...details].join('\n')
  })
  return `${blocks.join('\n\n')}\n\nTap an answer here or answer in the terminal.`
}

function buttonsOf({ questions, picked, isDone }: Asking): NoticeButton[][] {
  return questions.flatMap(({ options, multiSelect }, q) => {
    const mark = (o: number) => (picked[q].has(o) ? (multiSelect ? '☑ ' : '✅ ') : multiSelect ? '☐ ' : '')
    const prefix = questions.length > 1 ? `${q + 1}. ` : ''
    const rows = options.map((option, o) => [{ text: `${prefix}${mark(o)}${option.label}`, data: `${q}:${o}` }])
    return multiSelect && !isDone[q] ? [...rows, [{ text: `${prefix}Done`, data: `${q}:${DONE}` }]] : rows
  })
}

/** AskUserQuestion's `answers`: question text → label, multi-select labels joined by ", ". */
function answersOf({ questions, picked }: Asking): Record<string, string> {
  const labels = (q: number) => [...picked[q]].sort().map(o => questions[q].options[o].label)
  return Object.fromEntries(questions.map((question, q) => [question.question, labels(q).join(', ')]))
}
