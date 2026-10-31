import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'
import { IMAGE_SIZE, rgbaOf, SCENES } from './clawd.ts'
import type { Scene } from './clawd.ts'
import type { Band } from './status.ts'

const band = atom({ plugin: 'barista', key: 'band' } as const, null, { shape: 'band-with-scene' })
const tick = atom({ plugin: 'barista', key: 'tick' } as const, 0)

const LOOK = {
  bound: { mark: '●', color: 'success' },
  waiting: { mark: '⏳', color: 'warning' },
  idle: { mark: '○', color: 'subtle' },
  down: { mark: '✗', color: 'error' },
} as const

/** The Io port's status(): redraws the band, and ticks only while its scene has frames to move through. */
export function bandWriter($: EngineInterface): (view: Band) => void {
  let playing: Scene | undefined
  let timer: Timer | undefined
  return view => {
    void update($, band, () => view)
    if (view.scene === playing) return
    playing = view.scene
    timer?.cancel()
    void update($, tick, () => 0)
    const { frames, frameMs } = SCENES[playing]
    timer = frames.length > 1 ? $.clock.every(frameMs, () => void update($, tick, n => n + 1)) : undefined
  }
}

/** One row above the prompt: Clawd, and where this session listens in Telegram or why it cannot. */
export function hookBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, band)
    if (!view || e.props.hasSurvey) return next(e)
    const { frames, emoji } = SCENES[view.scene]
    const step = (await read($, tick)) % frames.length
    const { Box, Text } = $.ui.resolve(e)
    const look = LOOK[view.tone]
    return (
      <Box>
        {e.surface === 'terminal'
          ? h($.ui.resolve(e).Image, { source: { rgba: rgbaOf(frames[step]), width: IMAGE_SIZE, height: IMAGE_SIZE }, columns: 2, rows: 1, alt: emoji[step] })
          : <Text>{emoji[step]}</Text>}
        <Text color="claude" bold> barista </Text>
        <Text color={look.color}>{look.mark} {view.text}</Text>
        <Text dimColor>  {view.hint}</Text>
      </Box>
    )
  })
}
