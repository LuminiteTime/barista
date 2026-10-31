/** Clawd, the creature from the Claude Code intro, as an emoji-sized pixel sprite of the band. */

export type Scene = 'brew' | 'serve' | 'spill' | 'ask' | 'peek' | 'idle' | 'sleep' | 'down'

/** SIZE rows of SIZE palette characters. */
export type Frame = readonly string[]

/**
 * A scene with one frame stands still: only scenes that mean something is happening move.
 * `emoji` plays the same scene, frame for frame, where a terminal draws no pictures.
 */
export type Animation = { frames: readonly Frame[]; emoji: readonly string[]; frameMs: number }

/** The scenes that play for a moment after a turn, then give way to the band's resting scene. */
export type Moment = 'serve' | 'spill'

export const SIZE = 16

/** Pixels each sprite pixel becomes: about what a Retina terminal gives it, so its scaling does not blur the edges. */
const SCALE = 2

export const IMAGE_SIZE = SIZE * SCALE

/** How long a moment lasts. A spill stops before its frames run out, so the puddle never restarts as a full cup. */
export const MOMENT_MS: Record<Moment, number> = { serve: 6_000, spill: 3_000 }

export const PALETTE: Readonly<Record<string, readonly [number, number, number, number]>> = {
  '.': [0, 0, 0, 0],
  o: [217, 119, 87, 255],
  k: [30, 20, 16, 255],
  p: [250, 190, 170, 255],
  w: [214, 198, 172, 255],
  c: [121, 72, 40, 255],
  g: [190, 184, 174, 255],
  y: [247, 201, 92, 255],
  t: [127, 182, 232, 255],
}

const BODY = [
  '.ooooooo.',
  '.ooooooo.',
  '.ooooooo.',
  '.ooooooo.',
  'ooooooooo',
  'ooooooooo',
  '.ooooooo.',
  '.o.o.o.o.',
  '.o.o.o.o.',
]
const OPEN_EYES = ['.k...k.', '.k...k.']
const LOOK_LEFT = ['k...k..', 'k...k..']
const LOOK_RIGHT = ['..k...k', '..k...k']
const SHUT_EYES = ['.......', '.k...k.']
const HAPPY_EYES = ['.k...k.', 'p.....p']
const SAD_EYES = ['.......', '.k...k.', '.k...k.']

const EMPTY_CUP = [
  'w...w..',
  'w...www',
  'w...w.w',
  'w...w.w',
  'w...www',
  'w...w..',
  'wwwww..',
]
const FALLEN_CUP = [
  '.wwwww',
  '.....w',
  '.....w',
  '.wwwww',
]
const WISP = [
  ['.g', 'g.', '.g', 'g.'],
  ['g.', '.g', 'g.', '.g'],
]
const QUESTION = ['yyy', '..y', '.yy', '...', '.y.']
const SNORE = ['yyy', '..y', 'y..', 'yyy']
const SPARKLE = ['.y.', 'yyy', '.y.']

const CUP_LEVELS = 6
const CLAWD_Y = 6
const CUP_X = 9
const CUP_Y = 8
const CENTER_X = 3
const FLOOR = SIZE - 1

type Pose = { x?: number; y?: number; eyes?: readonly string[] }
type Layer = readonly [sprite: readonly string[], x: number, y: number]

/** Later layers paint over earlier ones; a sprite's dots leave what is under them. */
function frameOf(...layers: readonly Layer[]): Frame {
  const canvas = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('.'))
  for (const [sprite, x, y] of layers) {
    sprite.forEach((row, dy) => [...row].forEach((pixel, dx) => {
      if (pixel !== '.' && canvas[y + dy]?.[x + dx] !== undefined) canvas[y + dy][x + dx] = pixel
    }))
  }
  return canvas.map(row => row.join(''))
}

function clawd({ x = 0, y = CLAWD_Y, eyes = OPEN_EYES }: Pose = {}): Layer[] {
  return [[BODY, x, y], [eyes, x + 1, y + 1]]
}

/** A cup with `level` rows of coffee in it, CUP_LEVELS being full. */
function cup(level: number, x = CUP_X, y = CUP_Y): Layer[] {
  const coffee = Array.from({ length: CUP_LEVELS - level }, () => '...').concat(Array.from({ length: level }, () => 'ccc'))
  return [[EMPTY_CUP, x, y], [coffee, x + 1, y]]
}

const puddle = (width: number): Layer => [['c'.repeat(width)], SIZE - width, FLOOR]
const fallenCup: Layer = [FALLEN_CUP, CUP_X + 1, FLOOR - FALLEN_CUP.length]

/** Clawd bounces to the beat while the cup fills, one level per bar. */
function brewing(): Frame[] {
  const bar: Pose[] = [{}, { y: CLAWD_Y - 1 }, { x: 1 }, { x: 1, y: CLAWD_Y - 1, eyes: SHUT_EYES }]
  return Array.from({ length: (CUP_LEVELS + 1) * bar.length }, (_, step) => frameOf(
    ...cup(Math.floor(step / bar.length)),
    ...clawd(bar[step % bar.length]),
  ))
}

/** Clawd hops with the steaming cup held out, blushing. */
function serving(): Frame[] {
  return WISP.map((wisp, lift) => frameOf(
    ...cup(CUP_LEVELS, CUP_X, CUP_Y - lift),
    [wisp, CUP_X + 2, CUP_Y - lift - wisp.length],
    ...clawd({ y: CLAWD_Y - lift, eyes: HAPPY_EYES }),
    [SPARKLE, lift === 0 ? 0 : 5, lift === 0 ? 2 : 0],
  ))
}

// ponytail: the last frames repeat to hold the puddle on screen, so a scene needs no "play once" mode.
function spilling(): Frame[] {
  const sad = clawd({ y: CLAWD_Y + 1, eyes: SAD_EYES })
  const tear = (y: number): Layer => [['t'], 2, y]
  return [
    frameOf(...cup(CUP_LEVELS), ...clawd()),
    frameOf(...cup(2, CUP_X, CUP_Y + 1), ...clawd({ y: CLAWD_Y - 1 })),
    frameOf(fallenCup, puddle(3), ...clawd({ y: CLAWD_Y - 1 })),
    frameOf(fallenCup, puddle(5), ...sad),
    ...Array.from({ length: 6 }, (_, step) => frameOf(fallenCup, puddle(7), ...sad, tear(CLAWD_Y + 5 + step % 3))),
  ]
}

const peekAt = (eyes: readonly string[]): Frame => frameOf(...clawd({ x: CENTER_X, eyes }))
const askingAt = (y: number): Frame => frameOf(...clawd({ x: CENTER_X }), [QUESTION, CENTER_X + 3, y])

const still = (frame: Frame, emoji: string): Animation => ({ frames: [frame], emoji: [emoji], frameMs: 0 })

/** Plays `emoji` through `frames`, each for `hold` frames, the last one staying when `isLooping` is off. */
function animated(frames: readonly Frame[], frameMs: number, emoji: readonly string[], { hold = 1, isLooping = true } = {}): Animation {
  const emojiAt = (step: number) => {
    const shown = Math.floor(step / hold)
    return emoji[isLooping ? shown % emoji.length : Math.min(shown, emoji.length - 1)]
  }
  return { frames, frameMs, emoji: frames.map((_, step) => emojiAt(step)) }
}

export const SCENES: Record<Scene, Animation> = {
  brew: animated(brewing(), 260, ['🫘', '💧', '☕'], { hold: 4 }),
  serve: animated(serving(), 350, ['☕', '✨']),
  spill: animated(spilling(), 350, ['☕', '💦', '💦', '💧'], { isLooping: false }),
  ask: animated([askingAt(0), askingAt(1)], 500, ['🙋', '❓']),
  peek: animated([peekAt(LOOK_LEFT), peekAt(OPEN_EYES), peekAt(LOOK_RIGHT), peekAt(SHUT_EYES)], 600, ['👀', '🔍'], { hold: 2 }),
  idle: still(frameOf(...cup(CUP_LEVELS), ...clawd()), '☕'),
  sleep: still(frameOf(...clawd({ x: CENTER_X, y: CLAWD_Y + 1, eyes: SHUT_EYES }), [SNORE, 12, 1]), '💤'),
  down: still(frameOf(fallenCup, puddle(7), ...clawd({ y: CLAWD_Y + 1, eyes: SAD_EYES })), '💔'),
}

/** A frame as the base64 RGBA pixels an Image draws, IMAGE_SIZE on each side. */
export function rgbaOf(frame: Frame): string {
  const bytes = frame.flatMap(row => {
    const line = [...row].flatMap(pixel => Array.from({ length: SCALE }, () => [...PALETTE[pixel]]).flat())
    return Array.from({ length: SCALE }, () => line).flat()
  })
  return btoa(String.fromCharCode(...bytes))
}
