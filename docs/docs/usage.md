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

The bot learns chat and topic names only from messages it receives; Telegram has no call that lists a bot's chats or topics, and being an admin does not change that. When you bind to a chat or topic the bot has not seen, the session waits two minutes for any message there and binds when it arrives; the band shows `⏳ waiting for a message in …` with the time left. `/tg unbind` cancels the wait. Quotes around names are optional: `/tg bind "My chat" / "My topic"` works too.

After `/clear` the session id changes; the mod moves the binding to the new id by itself.

A band above the prompt shows where the session listens: `barista ● Work / backend` while bound, `○ not bound` with the bind command otherwise, and `✗ DAEMON_DOWN` with the fix when the daemon is unreachable. Collapse it with `[-]`.

The sprite before `barista` is Clawd, the barista, an emoji-sized picture drawn where the terminal shows images (kitty, Ghostty, iTerm2 3.5+ in fullscreen rendering). Elsewhere, Herdr among them, the same scenes play as a single emoji: `🫘 💧 ☕` during a turn, `☕ ✨` when served, `💦` on a spill, `🙋 ❓` for a question, `👀 🔍` while binding, and a still `☕`, `💤` or `💔` at rest. Clawd moves only while something is happening: bounces and fills a cup during a turn, hops with the steaming cup when the answer reaches Telegram, spills it when a turn fails or is aborted, shows a `?` while a question or permission waits for you, and looks around while a bind waits for its chat. Otherwise Clawd stands still: beside a full cup when bound, asleep when not, sad over a puddle when the daemon is down. `/tg status` says the same in words, plus the bot's name and the Remote Control link.

## Messages

In a group where other people are, only your messages that reply to one of the bot's messages or mention it (`@yourbot`) reach Claude, so talking to the others does not start turns. When only you and the bot are in the chat, and in the private chat with the bot, every message does. The member count is checked every 10 minutes and whenever someone joins or leaves.

Each such message becomes a prompt that starts with `[Telegram · <chat / topic>]`. Albums arrive as one prompt. Files are saved to `~/.barista/files/<chat>/<topic>/` and the prompt lists their paths. They are deleted after 7 days. Voice messages carry a transcript when whisper.cpp is installed. Replying to a message adds the quoted text (or the start of the original message) to the prompt.

`/stop` interrupts the running turn. Edited messages are ignored.

## Answers and files

Every final answer of a bound session goes to its topic, rendered as Telegram rich text (Markdown, tables, code blocks, links). An answer to a Telegram message is a reply to that message, so with several questions in flight you can tell which answer belongs where. Answers to prompts typed in the terminal are plain messages. Long answers are split on paragraph boundaries; only the first part is the reply.

Claude decides when a file says more than text and calls `telegram_send_files`: photos and videos go as an album, everything else as documents. Files sent during a Telegram turn reply to its message too. Telegram limits bots to 50 MB per upload and 10 MB per photo; bigger photos are sent as documents. A file over 50 MB, or one that does not exist, is left out and named in the tool's answer; the rest of the batch still goes.

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

Binding runs `/remote-control`, so the session is also open in the Claude app. When Claude needs permission, the topic gets one short notice, for example `🔐 Claude asks to run Bash: npm publish`, with the session's Remote Control link. Answer in the terminal or in the app. The notice is deleted when that tool call ends (allowed, denied or finished), when the turn ends, or when the session closes. If the session dies without closing, the daemon removes it within a minute and a half.

## Questions

When Claude asks you something (its AskUserQuestion tool), the topic gets the question as text, each option's description under it, and a button per option. Tap one and the session gets your answer, as if you had picked it in the terminal; the terminal dialog closes. For a question that takes several answers, tap each (☑ marks them) and then Done. The terminal dialog stays open meanwhile, and whichever side answers first wins; the question leaves Telegram either way. Only the bot's owner can press the buttons.
