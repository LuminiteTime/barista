# Telegram bridge for Claude Code — design

Name: **barista** (repo, CLI `barista`, mod `barista`).

## 1. Intent

The owner runs several Claude Code sessions at once, each in its own terminal window on a Mac
left open. Each session must be reachable from Telegram: one session per forum topic (or per
private chat / plain group), several chats at once, two-way, with rich content. Today this is
set up by hand every session (Claude hunts for the token, the chat and the topic), which is slow
and flaky. The official `telegram` channel plugin is rejected: its `bun` process burns 80–100%
CPU idle, it loads into every session, and parallel sessions fight over one bot's `getUpdates`.

Success: open a session, say "bind to topic *backend* in chat *Work*" (or `/tg bind Work /
backend`), and from then on the topic behaves like a second prompt box for that session.

## 2. Goals

- One-step binding of a session to `chat` or `chat / topic`, by human-readable names.
- Many sessions bound to many chats/topics simultaneously, one bot token.
- Inbound: text with formatting, links, photos, videos, documents, albums, voice/audio
  (transcribed when a local transcriber exists), replies-to-message context.
- Outbound: **every** final answer of the session (whether the prompt came from the terminal or
  Telegram) is mirrored to the bound topic automatically; Claude additionally sends any
  artifacts it chooses (screenshots, videos, files) via a tool.
- On bind, Remote Control is started for the session; permission questions are answered in the
  terminal or the Remote Control app, Telegram gets a short notice that is removed once answered (§7).
- Terminal stays a normal Claude Code session; Telegram is an extra input, not a replacement.
- Errors are explicit and actionable: what failed, what the user must do by hand.
- Lightweight: near-zero idle CPU, zero runtime npm dependencies, small readable codebase.

## 3. Non-goals

- No messages are delivered for a topic while no session listens; nothing is replayed later.
- No "session offline" notices in Telegram.
- No video notes ("circles") processing beyond delivering the file path.
- No multi-user access: only the owner's Telegram user id is obeyed.
- No headless/SDK sessions; no launching sessions from Telegram.

## 4. Anti-goals (failure even if it "works")

- Idle CPU noticeably above zero, or more than one poller per token.
- Stale permission messages left hanging in Telegram after the decision was made anywhere.
- Silent failures (a message that vanished with no visible reason).
- A codebase that needs the author to explain it.

## 5. Architecture

Two processes, one protocol, clean boundary: the **daemon** is the Telegram adapter; the
**mod** is the Claude Code adapter. Neither knows the other's platform.

```
Telegram ⇄ HTTPS long-poll ⇄ [ daemon (launchd, Node 24) ] ⇄ unix socket HTTP ⇄ [ mod in session A ]
                                                                               ⇄ [ mod in session B ]
```

### 5.1 Daemon (`daemon/`)

Single long-running Node 24 process under launchd (`KeepAlive`, `RunAtLoad`). The **only**
holder of the bot token and the only `getUpdates` caller (Bot API allows one poller per token).
Long polling with `timeout=50` gives near-zero idle CPU.

Responsibilities, one module each:

| Module | Responsibility |
|---|---|
| `main.ts` | Composition root: load config, wire modules, start poller + socket server. |
| `config.ts` | Read `~/.barista/config.json` (`token`, `ownerId`, optional `transcriber`). |
| `telegram/api.ts` | Thin Bot API client: `call(method, params)`, multipart upload, file download. |
| `telegram/poller.ts` | `getUpdates` loop, persisted offset, exponential backoff on network errors. |
| `registry.ts` | Directory of chats and topics the bot has seen: title → `chat_id`, topic name → `message_thread_id`. Persisted. |
| `bindings.ts` | `session_id ↔ (chat_id, thread_id?)`, liveness, conflicts. Persisted. |
| `inbound.ts` | `Update` → `InboundMessage`: owner gate, entities → Markdown, media download, album grouping, reply quote, voice transcription. |
| `outbound.ts` | Text (Markdown → Telegram HTML, split ≤4096, plain-text fallback on parse error), files, albums, permission cards, deletes, reactions. |
| `format/*.ts` | Pure converters: `markdown-to-html`, `entities-to-markdown`, `split`. |
| `server.ts` | HTTP over `~/.barista/barista.sock`, JSON in/out, maps errors to `{code, message, hint}`. |
| `transcribe.ts` | Optional: `ffmpeg` → wav → `whisper-cli` if configured/installed; otherwise skipped. |
| `cli.ts` | `barista setup | status | doctor | logs | uninstall`. |

**Registry.** Bot API cannot list a bot's chats or a forum's topics, so the daemon learns them
from updates: `message.chat.title`, `my_chat_member`, `forum_topic_created/edited`, and
`reply_to_message.forum_topic_created` (present on messages inside a topic). A topic unseen so
far is unresolvable by name → error with hint "send any message in that topic, or bind with
`create`". `General` topic = no thread id. Private chat with the owner binds as `me`/`dm`.

**Liveness.** A binding is *live* while its mod long-polls `/inbox` (no poll for 60 s → offline).
Updates for chats/topics with no live binding are used only to refresh the registry, then
dropped. Binding records persist by `session_id` so `claude --resume` re-attaches.

**Owner gate.** Only updates whose `from.id == ownerId` are routed (gate on sender, never on
chat). Callback queries likewise. Others are dropped and logged at debug level.

### 5.2 Mod (`mod/`)

A Claude Code mod (plugin with a hooks module, TS). Hooks and calls used:

| Need | API |
|---|---|
| Re-attach on start/resume, start inbox loop | `session.start` → `POST /attach`, loop `GET /inbox` with `$.http.fetch({ socketPath })` |
| Deliver a Telegram message as a prompt | `$.prompt.submit({ text })` (queues; starts its own turn when idle) |
| Mirror every final answer | `turn.complete` hook (main loop only, `reason: 'answer'`, non-empty text) → `POST /send` |
| Tell Claude how the bridge works | `prompt.compose`: one short system section while bound |
| Binding by command | `$.command.register({ name: 'tg' })`: `/tg bind <chat> [/ <topic>] [--create] [--force]`, `/tg unbind`, `/tg status` |
| Binding by natural language + artifacts | `$.tool.register`: `telegram_bind`, `telegram_unbind`, `telegram_send_files`, `telegram_status` (`isDeferred: false`) |
| Visible state | `$.ui.status("TG: Work / backend ✓")`, `$.ui.toast` for errors |
| Stop from phone | `/stop` in topic → `$.turn.abort` on the running turn |
| Remote Control on bind | `$.command.run({ command: 'remote-control' })`; post the session link to the topic if the command reports one |
| Permission notice | §7 |

Inbound prompt shape (one header line, then content):

```
[Telegram · Work / backend]
<text as Markdown>
↪ in reply to: "<first 300 chars of the quoted message>"
📎 /Users/…/.barista/files/<chat>/<thread>/<file>   (one line per attachment; images open with Read)
🎙 transcript: <text>                               (voice/audio, when transcribed)
```

**Reply context**: when the owner uses Telegram's *Reply* on a specific earlier message (e.g.
replies "redo this" to one of Claude's answers), the quoted message's text is added so Claude
knows what "this" refers to. No other reply-based interactions in v1.

**Delivery receipts** (reactions on the owner's message, no extra messages):
👀 the session's mod received it and queued it (the session may be busy) → ✍ its turn started.
No reaction means no live session listened; the message is dropped (§3).

**Chat-level binding** (no topic given) on a forum chat: the session receives messages from every
topic of that chat that has no topic-level binding of its own (topic bindings win). Replies go to
the topic of the latest inbound message, General at first.

Outbound tool `telegram_send_files({ files: [{ path, caption? }], caption? })`: daemon picks
`sendPhoto`/`sendVideo`/`sendDocument` by MIME, `sendMediaGroup` for 2–10 photos/videos.
Text goes only through the automatic mirror, never the tool, to avoid duplicates.

## 6. Socket protocol (mod ⇄ daemon)

HTTP/1.1 JSON over `~/.barista/barista.sock` (dir `0700`, socket `0600`). Types live in one
shared `protocol.ts`. Every error: `{ "error": { "code", "message", "hint" } }`.

| Endpoint | Purpose |
|---|---|
| `POST /attach {sessionId}` | Re-attach existing binding, if any. |
| `POST /bind {sessionId, chat, topic?, create?, force?}` | Resolve names, create topic if asked, bind. Conflict with another **live** session → `TOPIC_TAKEN` unless `force`. |
| `POST /unbind {sessionId}` | Drop binding. |
| `GET /inbox?sessionId&wait=25` | Long-poll; returns `[InboundMessage | StopRequest]`. Doubles as heartbeat. |
| `POST /ack {sessionId, messageIds, stage}` | `queued` → 👀, `started` → ✍. |
| `POST /send {sessionId, text}` | Mirror a final answer. |
| `POST /send-files {sessionId, files, caption?}` | Artifacts. |
| `POST /notice {sessionId, key, text}` | Post a short notice (permission question); returns its id. |
| `DELETE /notice {sessionId, key}` | Delete it (answered, aborted, session ended). |
| `GET /chats` | Registry dump for status/errors. |
| `GET /health` | Version, uptime, bot username, privacy-mode flag. |

Error codes (non-exhaustive): `DAEMON_DOWN` (mod-side), `CHAT_UNKNOWN`, `TOPIC_UNKNOWN`,
`TOPIC_TAKEN`, `NOT_FORUM`, `NO_RIGHTS` (needs admin + Manage Topics), `PRIVACY_MODE`
(bot can't read group messages: disable via @BotFather `/setprivacy` or make it admin),
`FILE_TOO_BIG` (Bot API: 20 MB download, 50 MB upload), `TG_API` (passes Telegram's description).

## 7. Permission questions

Decisions are made where Claude Code already supports them: the terminal dialog or the
**Remote Control** session (phone app / claude.ai), started automatically on bind
(`/remote-control` via `$.command.run`; if it fails, e.g. not logged in with claude.ai, the error
and its hint go to the status line and to the topic once).

Telegram only gets a notice, one line: `🔐 Claude asks to run Bash: <description>` plus the RC
link. Contract: the notice is **deleted** as soon as the question is settled anywhere (allowed,
denied, turn aborted, session ended); on daemon start, notices of offline sessions are deleted.
No buttons in Telegram.

Detection, builder's choice within the mod API: `tool.check` hook (`await next(e)`; verdict `ask`
with `approver: 'person'` → post notice) and the matching `tool.call` hook (`await next(e)`
resolves once the dialog is settled and the tool ran/was refused → delete). If a more precise
"dialog settled" signal exists (e.g. `classic.Notification` / permission events), prefer it, so
the notice does not linger while a long tool runs.

## 8. Setup & lifecycle

`barista setup`: asks for the bot token → validates with `getMe` → "send /start to @bot" →
captures `ownerId` → writes config (`0600`) → installs `~/Library/LaunchAgents/<label>.plist`
→ `launchctl bootstrap` → installs the mod from the local clone (`claude plugin marketplace add
<repo path>` + `claude plugin install barista@barista`) → prints a checklist (privacy mode,
admin rights, claude.ai login for Remote Control).
Install = clone the repo + `npm link` (puts `barista` on PATH). The plist runs the absolute Node
path found at setup (`process.execPath`) with the absolute repo path of `daemon/main.ts`.
Publishing to GitHub is out of scope for now; README quick start assumes a clone.
`barista doctor`: checks daemon, socket, token, privacy mode, rights per known chat, transcriber.
State dir `~/.barista/`: `config.json`, `state.json` (offset, registry, bindings), `files/`,
`daemon.log` (no rotation in v1; ceiling noted in code).

## 9. Stack and quality

- TypeScript everywhere. Daemon on Node 24 running `.ts` directly (type stripping): erasable
  syntax only, imports with `.ts` extensions. Mod in TS as the mod engine requires.
- Runtime dependencies: none (stdlib `fetch`, `FormData`, `fs.openAsBlob`, `node:http` on a
  unix socket, `node:child_process` for ffmpeg/whisper). Dev: `typescript`, `eslint`,
  `typescript-eslint`, `@types/node`.
- Lint: ESLint flat config with `max-lines: 200` (per file), `max-lines-per-function: 40`,
  `complexity: 10`, `max-depth: 3`, `max-params: 4`. `tsc --noEmit` strict.
- Tests: `node --test` for pure modules (format, registry, bindings, inbound mapping, split);
  `claude plugin test` for the mod. Uncle Bob / clean-code: small functions, one reason to change
  per module, dependencies point inward (format/registry/bindings know nothing of HTTP or TG).
- CI: GitHub Actions on Node 24: lint, typecheck, test.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`…), authored by the owner only, no
  co-author trailers.
- README in English: icon (SVG made for the project), badges, 30-second quick start,
  architecture diagram, troubleshooting by error code. Plain, no filler.

## 10. Left to the builder

- Exact repo layout beyond `daemon/`, `mod/`, shared `protocol.ts` (verify the mod engine can
  type-import a file outside the plugin folder; else keep `protocol.ts` inside `mod/`).
- Markdown ↔ Telegram HTML converter scope (bold, italic, strike, code, pre with language,
  links, blockquote, lists as text); everything else passes escaped.
- Album grouping window (≈1 s by `media_group_id`).
- Exact wording of messages, status line, and error hints.
