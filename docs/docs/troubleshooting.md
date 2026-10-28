---
sidebar_position: 4
---

# Troubleshooting

Start with `barista doctor` and `barista logs`. Errors in Claude Code and in Telegram carry a code and the fix.

| Code | Meaning | Fix |
|---|---|---|
| `DAEMON_DOWN` | the mod cannot reach the daemon socket | `barista start`; if it stops again, read `barista logs` |
| `NOT_CONFIGURED` | no token or owner in `~/.barista/config.json` | `barista setup` |
| `CHAT_UNKNOWN` | the bot has not seen a chat with that title | add the bot, send any message in the chat, or bind by chat id |
| `NOT_FORUM` | a topic was given for a chat without topics | bind the chat alone |
| `TOPIC_REQUIRED` | the chat has topics | `/tg bind <chat> / <topic>` |
| `TOPIC_UNKNOWN` | the bot has not seen that topic | send a message in it, or add `--create` |
| `TOPIC_TAKEN` | another live session listens there | `/tg unbind` in that session, or `--force` |
| `NOT_BOUND` | this session is not bound | `/tg bind …` |
| `NO_RIGHTS` | Telegram refused to create the topic | give the bot the Manage Topics admin right |
| `FILE_NOT_FOUND` | a file Claude tried to send does not exist | check the path |
| `FILE_TOO_BIG` | over Telegram's bot limits: 20 MB download, 50 MB upload | compress or split |
| `TG_API` | Telegram rejected a request | the message includes Telegram's description |
| `BAD_REQUEST`, `INTERNAL` | a bug in barista | open an issue with the lines from `barista logs` |

## Messages get no reaction

- No session is bound to that topic: `barista status` lists the bindings.
- The bot cannot read the group. Admins read everything; otherwise privacy mode must be off (`barista doctor` shows it). Disable it with @BotFather, then remove and re-add the bot to the group: Telegram applies the change on join.
- The chat is not in the `chats` allowlist, if you set one.
- Only the owner's messages count; messages from other members are ignored.

## "Another poller holds this bot token (409)"

A bot token allows one `getUpdates` connection. After a restart Telegram may hold the old one for up to a minute. If the warning repeats, some other program uses the same token (another bot framework, an old script, the official Telegram plugin for Claude Code). Stop it or give barista its own bot.

## Voice messages arrive without a transcript

`barista doctor` lists what is missing. Install with `brew install ffmpeg whisper-cpp` and download the model with `barista setup` (it keeps the existing config).
