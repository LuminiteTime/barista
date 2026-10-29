#!/usr/bin/env node
// A checkout runs the TypeScript sources as they are (Node 24 strips types), so installing needs no build.
// The release tarball ships without src and lands under node_modules, where Node refuses to strip types: it runs dist.
import { existsSync } from 'node:fs'
import { URL } from 'node:url'

const source = new URL('../src/cli/main.ts', import.meta.url)
await import(existsSync(source) ? source.href : new URL('../dist/src/cli/main.js', import.meta.url).href)
