---
sidebar_position: 6
---

# Contributing

```sh
npm ci
npm run check      # secret scan, eslint, tsc, node --test, build
npm run check:mod  # claude plugin validate, claude plugin test, tsc for the mod
```

- TypeScript run natively by Node 24 (type stripping): only erasable syntax, relative imports with `.ts`.
- ESLint enforces size: 200 lines per file, 40 per function, complexity 10, depth 3, four parameters.
- Tests use `node:test` and a fake Telegram server (`test/fake-telegram.ts`); none of them touch the real API.
- Commits follow `feat:`, `fix:`, `docs:`, `chore:`.

## Secrets

The repository is public, so no secret and nothing personal may enter it.

- **Real secrets live outside the repository.** The bot token is in `~/.barista/config.json` (mode 0600). It never goes in arguments, environment variables or logs: `barista setup` reads it hidden or from a file, and Bot API errors never include the URL that carries it.
- **Tests use made-up values**: user `1001`, bot `@coffee42_bot`, chat «Мастерская».
- **`scripts/check-secrets.ts` stops leaks.** It fails on anything shaped like a Telegram bot token or a private key. It also fails on every value listed in `.secrets.local`, one per line: your Telegram id, your bot's username, your chat titles. That file is gitignored, so it stays on your machine. Findings name the file and the line, never the value.
- **It runs twice.** `npm run check` (CI included) scans the tracked files. The pre-commit hook scans what the commit holds; `npm ci` turns the hook on (`core.hooksPath = .githooks`).

If something slips into a commit that was not pushed, rewrite it out with `git filter-repo --replace-text`. If it was pushed, treat it as leaked: revoke the token with @BotFather (`/revoke`), then clean the history.

## Trying changes

Run the daemon in the foreground against a separate home to try changes:

```sh
BARISTA_HOME=/tmp/bh BARISTA_DEBUG=1 node src/cli/main.ts daemon
claude --plugin-dir mod
```

Keep `BARISTA_HOME` short: macOS limits unix socket paths to 104 bytes.

The docs site lives in `docs/`: `cd docs && npm install && npm start`.
