// The engine wants the contract self-contained, so Band repeats hooks/status.ts.
export type Band = { tone: 'bound' | 'idle' | 'down'; text: string; hint: string }

declare module 'claude-code' {
  interface PluginState {
    barista: { band: Band | null }
  }
}
