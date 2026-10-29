---
sidebar_position: 2
---

# Install

## Prerequisites

| What | Why | How |
|---|---|---|
| macOS | the daemon runs as a launchd agent | |
| [Homebrew](https://brew.sh) | installs Node and the voice tools | see brew.sh |
| Node.js 24 or newer | runs barista | `brew install node` |
| Claude Code with mods support | barista is a Claude Code mod | `claude --version` |
| claude.ai login in Claude Code | Remote Control needs it | run `claude`, then `/login` |
| ffmpeg and whisper.cpp | voice transcripts (optional) | `brew install ffmpeg whisper-cpp`; setup offers it |

## Create the bot

1. Open [@BotFather](https://t.me/BotFather), send `/newbot`, choose a name and a username, copy the token.
2. Let the bot read group messages: make it an admin in each group, or send `/setprivacy` to @BotFather and choose **Disable** for the bot.
3. In a group with topics, give the bot the admin right **Manage Topics** if you want it to create topics.

## Install the package

From a release tarball (built by CI on every tag):

```sh
npm install -g ./barista-0.1.0.tgz
```

From source:

```sh
git clone <repo> barista && cd barista
npm ci && npm run build && npm install -g .
```

## Run setup

```sh
barista setup
```

Setup asks for the token (the input is hidden), checks it with Telegram, and waits for you to send `/start` to the bot in a private chat. That message tells barista your user id; the bot ignores everyone else. Then it offers the voice tools (about 150 MB with the model), installs the launchd agent `dev.barista.daemon`, and installs the Claude Code mod from the package.

| Flag | Effect |
|---|---|
| `--token-file <path>` | read the token from a file instead of asking: the bare token, or an `.env` line such as `TELEGRAM_BOT_TOKEN=…`. There is no `--token` flag, because `ps` and shell history would show it |
| `--owner <id>` | skip the `/start` step |
| `--chats <id,id>` | only these chats are ever read; the bot learns them at start, so you can bind by name right away |
| `--yes` | accept every offer |
| `--no-voice` | skip ffmpeg, whisper.cpp and the model |
| `--no-mod` | skip the Claude Code mod |

## Check

```sh
barista doctor
```

Each line is ✓, or ✗ with the command that fixes it. Restart open Claude Code sessions so they load the mod.

## Remove

```sh
barista uninstall          # agent and mod
barista uninstall --purge  # also ~/.barista (config, state, received files)
npm uninstall -g barista
```
