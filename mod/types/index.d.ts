// The engine wants the contract self-contained, so Band repeats hooks/status.ts and Scene hooks/clawd.ts.
export type Scene = 'brew' | 'serve' | 'spill' | 'ask' | 'peek' | 'idle' | 'sleep' | 'down'
export type Band = { tone: 'bound' | 'waiting' | 'idle' | 'down'; text: string; hint: string; scene: Scene }

declare module 'claude-code' {
  interface PluginState {
    barista: { band: Shaped<Band | null>; tick: number }
  }
}
