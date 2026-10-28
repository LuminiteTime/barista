---
sidebar_position: 3
---

# Usage

## Binding

```
/tg bind <chat> [/ <topic>] [--create] [--force]
/tg unbind
/tg status
```

You can also ask Claude in plain words ("listen to topic backend in Work"); the mod gives Claude the same tools.

- `<chat>` is the chat title as Telegram shows it, its numeric id, or `me` for the private chat with the bot.
- A chat with topics needs a topic. `general` is the General topic.
- A chat without topics binds whole; giving a topic is an error.
- `--create` creates the topic when the bot has not seen it.
- `--force` takes a topic held by another live session. A session counts as live while it polls; one that has been silent for a minute loses the topic to anyone.

The bot learns chat and topic names only from messages it receives; Telegram has no call that lists topics. Send any message in a new topic before binding to it by name, or use `--create`.

After `/clear` the session id changes; the mod moves the binding to the new id by itself.

## Messages

Each message in the bound topic becomes a prompt that starts with `[Telegram · <chat / topic>]`. Albums arrive as one prompt. Files are saved to `~/.barista/files/<chat>/<topic>/` and the prompt lists their paths. Voice messages carry a transcript when whisper.cpp is installed. Replying to a message adds the quoted text (or the start of the original message) to the prompt.

`/stop` interrupts the running turn. Edited messages are ignored.

## Answers and files

Every final answer of a bound session goes to its topic, rendered as Telegram rich text (Markdown, tables, code blocks, links). Long answers are split on paragraph boundaries.

Claude decides when a file says more than text and calls `telegram_send_files`: photos and videos go as an album, everything else as documents. Telegram limits bots to 50 MB per upload and 10 MB per photo; bigger photos are sent as documents.

## Reactions

| | Meaning |
|---|---|
| 👀 | the session got the message and will run it after the current turn |
| ✍ | Claude is working on it; the topic shows "typing…" |
| 🤔 | Claude is waiting for a permission decision |
| 👌 | answered |
| 🙈 | interrupted |
| 💔 | failed; the reason follows as a message |
| 🤷 | the message type is not supported (stickers, polls and similar) |

No reaction means no session listens in that topic.

## Permissions

Binding runs `/remote-control`, so the session is also open in the Claude app. When Claude needs permission, the topic gets one short line, for example `🔐 Claude asks to run Bash: npm publish`. Answer in the terminal or in the app. The notice is deleted as soon as the question is settled, also when the turn ends or the session closes.
