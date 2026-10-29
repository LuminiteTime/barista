import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { Band } from './status.ts'

const band = atom({ plugin: 'barista', key: 'band' } as const, null)

const LOOK = {
  bound: { mark: '●', color: 'success' },
  waiting: { mark: '⏳', color: 'warning' },
  idle: { mark: '○', color: 'subtle' },
  down: { mark: '✗', color: 'error' },
} as const

/** The Io port's status(): redraws the band. */
export function bandWriter($: EngineInterface): (view: Band) => void {
  return view => void update($, band, () => view)
}

/** One row above the prompt: where this session listens in Telegram, or why it cannot. */
export function hookBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, band)
    if (!view || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const look = LOOK[view.tone]
    return (
      <Box>
        <Text color="claude" bold>☕ barista </Text>
        <Text color={look.color}>{look.mark} {view.text}</Text>
        <Text dimColor>  {view.hint}</Text>
      </Box>
    )
  })
}
