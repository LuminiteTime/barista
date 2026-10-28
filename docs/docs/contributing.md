---
sidebar_position: 6
---

# Contributing

```sh
npm ci
npm run check      # eslint, tsc, node --test, build
npm run check:mod  # claude plugin validate, claude plugin test, tsc for the mod
```

- TypeScript run natively by Node 24 (type stripping): only erasable syntax, relative imports with `.ts`.
- ESLint enforces size: 200 lines per file, 40 per function, complexity 10, depth 3, four parameters.
- Tests use `node:test` and a fake Telegram server (`test/fake-telegram.ts`); none of them touch the real API.
- Commits follow `feat:`, `fix:`, `docs:`, `chore:`.

Run the daemon in the foreground against a separate home to try changes:

```sh
BARISTA_HOME=/tmp/bh BARISTA_DEBUG=1 node src/cli/main.ts daemon
claude --plugin-dir mod
```

Keep `BARISTA_HOME` short: macOS limits unix socket paths to 104 bytes.

The docs site lives in `docs/`: `cd docs && npm install && npm start`.
