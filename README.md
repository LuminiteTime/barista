<div align="center">

<img src="assets/icon.svg" width="112" alt="barista icon">

# barista

**Talk to your Claude Code sessions from Telegram.**

Bind any running session to a Telegram chat or forum topic. Messages there become prompts, every answer comes back, and Claude can send you screenshots and files.

![macOS](https://img.shields.io/badge/macOS-only-1c110c?logo=apple&logoColor=white)
![Node 24](https://img.shields.io/badge/node-%E2%89%A524-3a2419?logo=nodedotjs&logoColor=white)
![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-f07c2c)
![License MIT](https://img.shields.io/badge/license-MIT-c9a989)

</div>

---

You start Claude Code on your Mac as usual, type `/tg bind Work / backend`, and leave the laptop open. From then on the *backend* topic in your *Work* group is a second prompt box for that session. Several sessions can listen to several topics at once, one bot for all of them.

```
you, in Telegram  ─▶  barista daemon  ─▶  Claude Code session  ─▶  answer back in the same topic
```

## What you get

- One command per session to bind it: `/tg bind <chat> / <topic>`, or just ask Claude ("bind to topic backend in Work").
- Every final answer is mirrored to the topic, including answers to prompts you typed in the terminal. Markdown, tables, code and links render natively in Telegram.
- Claude sends files when they say more than text: screenshots, videos, logs, documents, albums.
- You can send text, photos, videos, files, albums and voice messages. Voice is transcribed locally with whisper.cpp.
- Reactions show where each of your messages is:

  | | |
  |---|---|
  | 👀 | the session got it (it may still be busy) |
  | ✍ | Claude is working on it, and the topic shows "typing…" |
  | 🤔 | waiting for your permission |
  | 👌 | answered |
  | 🙈 | interrupted |
  | 💔 | failed (the reason follows as a message) |
  | 🤷 | message type not supported |

  No reaction means no session listens there right now; such messages are ignored.
- Binding also turns on Remote Control, so permission prompts can be answered from the Claude app on your phone. The topic gets a short notice that disappears as soon as the question is answered anywhere.
- `/stop` in the topic interrupts the current turn. Replying to a specific message quotes it into the prompt.

## How it works

```mermaid
flowchart LR
  TG[Telegram Bot API] <-- long polling --> D[barista daemon<br/>launchd, Node 24]
  D <-- JSON over a unix socket --> A[mod in session A]
  D <-- JSON over a unix socket --> B[mod in session B]
```

A Telegram bot token allows only one `getUpdates` poller, so one small daemon owns it and routes messages to sessions. Each Claude Code session runs the barista mod, which long-polls its own inbox, submits messages as prompts, and mirrors answers back. The daemon idles on a 50-second long poll, so it uses almost no CPU.

## Install

### 1. Prerequisites

| What | Why | How |
|---|---|---|
| macOS | the daemon runs as a launchd agent | |
| [Homebrew](https://brew.sh) | installs the tools below | see brew.sh |
| Node.js 24 or newer | runs barista | `brew install node` |
| Claude Code with mods support | barista is a Claude Code mod | [docs](https://code.claude.com/docs) |
| A claude.ai login in Claude Code | Remote Control needs it | `claude` → `/login` |
| ffmpeg + whisper.cpp (optional) | voice message transcripts | `brew install ffmpeg whisper-cpp` (setup offers this) |

### 2. Create the bot

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name and a username. Copy the token.
2. Let the bot read group messages. Either make it an admin in each group, or send `/setprivacy` to @BotFather, pick the bot and choose **Disable**.
3. For a group with topics: enable Topics in the group settings and give the bot the admin right **Manage Topics**, so it can create topics for you.

### 3. Install barista

From a release tarball:

```sh
npm install -g ./barista-0.1.0.tgz
```

Or from source:

```sh
git clone <this repo> barista && cd barista
npm ci && npm run build && npm install -g .
```

### 4. Run setup

```sh
barista setup
```

It asks for the bot token, then waits until you send `/start` to the bot in a private chat (that is how it learns your Telegram user id; only you can talk to your sessions). Then it offers to install the voice tools, starts the daemon as a launchd agent, and installs the Claude Code mod.

Optional flags: `--token`, `--owner <your user id>`, `--chats <id,id>` (ignore every other chat), `--yes`, `--no-voice`, `--no-mod`.

### 5. Check it

```sh
barista doctor
```

Every line is either ✓ or ✗ with the exact fix.

### 6. Bind a session

Restart any open Claude Code sessions so they load the mod, then in one of them:

```
/tg bind Work / backend
```

The bot only knows chats and topics it has seen. If it answers `TOPIC_UNKNOWN`, send any message in that topic and retry, or add `--create` to create the topic. Send `/tg bind me` to use the private chat with the bot.

## Commands

| In Claude Code | |
|---|---|
| `/tg bind <chat> [/ <topic>] [--create] [--force]` | bind this session (`--force` takes a topic from another live session) |
| `/tg unbind` | stop listening |
| `/tg status` | where this session is bound |

| In Telegram | |
|---|---|
| `/stop` | interrupt the running turn |

| In a terminal | |
|---|---|
| `barista setup` | install or reconfigure |
| `barista doctor` | check everything |
| `barista status` | daemon health and which session listens where |
| `barista logs` | follow the daemon log |
| `barista start` / `stop` | control the daemon |
| `barista uninstall [--purge]` | remove the agent and the mod (`--purge` also deletes `~/.barista`) |

## Troubleshooting

| Code | Meaning | Fix |
|---|---|---|
| `DAEMON_DOWN` | the mod cannot reach the daemon | `barista start`, then `barista logs` |
| `NOT_CONFIGURED` | no token or owner | `barista setup` |
| `CHAT_UNKNOWN` | the bot has not seen that chat | add the bot, send any message there |
| `TOPIC_REQUIRED` | the chat has topics; bind one | `/tg bind <chat> / <topic>` |
| `TOPIC_UNKNOWN` | the bot has not seen that topic | send a message in it, or use `--create` |
| `NOT_FORUM` | a topic was given for a chat without topics | bind the chat alone |
| `TOPIC_TAKEN` | another live session listens there | unbind it, or `--force` |
| `NO_RIGHTS` | Telegram refused to create a topic | give the bot "Manage Topics" |
| `FILE_TOO_BIG` | over Telegram's bot limits (20 MB in, 50 MB out) | compress or split the file |
| `TG_API` | Telegram rejected a request | the message carries Telegram's reason |

If messages in a group never get a 👀, the bot probably cannot read them: make it an admin or disable privacy mode. If the log says another process polls the token (409), stop the other bot client: one token allows one poller.

Everything barista keeps is in `~/.barista`: `config.json` (token, mode 600), `state.json`, received `files/`, `daemon.log`.

## Development

```sh
npm ci
npm run check       # lint (file and function size limits), typecheck, tests, build
npm run check:mod   # validate, test and typecheck the mod (needs the claude CLI)
```

The code is in three parts. `src/daemon` is the Telegram side: Bot API client, poller, chat registry, bindings, inbound and outbound messages, socket API. `src/cli` holds `barista` and its launchd setup. `mod/hooks` is the Claude Code side; `mod/hooks/protocol.ts` is the contract between the two. More in the [docs](docs/).

## License

MIT
