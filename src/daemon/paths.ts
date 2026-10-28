import { homedir } from 'node:os'
import { join } from 'node:path'

export type Paths = {
  home: string
  config: string
  state: string
  files: string
  models: string
  log: string
  socket: string
}

export function paths(home = process.env.BARISTA_HOME ?? join(homedir(), '.barista')): Paths {
  return {
    home,
    config: join(home, 'config.json'),
    state: join(home, 'state.json'),
    files: join(home, 'files'),
    models: join(home, 'models'),
    log: join(home, 'daemon.log'),
    socket: join(home, 'barista.sock'),
  }
}
