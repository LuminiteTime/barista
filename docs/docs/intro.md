---
slug: /
sidebar_position: 1
---

# barista

barista binds a running Claude Code session to a Telegram chat or forum topic through your own bot. Messages in the topic become prompts in that session, every final answer is mirrored back, and Claude can send screenshots, videos and files when they help.

You keep working in the terminal as usual. Telegram is a second prompt box, handy when you are away from the laptop.

![A message in a Telegram topic becomes a prompt in Claude Code; the answer comes back as a reply](/img/demo/chat.gif)

![Claude's question in Telegram with a button per option; a tap answers it](/img/demo/question.gif)

## What it does

- Binds by name: `/tg bind Work / backend`. Forum chats bind only by topic; plain groups and the private chat bind whole.
- Many sessions at once, each in its own topic, one bot for all of them.
- Mirrors answers to prompts typed in the terminal too.
- Accepts text, photos, videos, files, albums and voice (transcribed locally with whisper.cpp). A reply to a message quotes it into the prompt.
- Shows progress with reactions on your message.
- Tells the topic when Claude needs permission, with a short notice that is deleted once the question is settled.
- Sends Claude's questions with a button per option: a tap answers them.

## What it does not do

- It does not answer permission prompts from Telegram. You decide in the terminal.
- It does not queue messages for sessions that are closed. With no session listening, messages are ignored.
- It runs on macOS only (launchd).

Next: [Install](install.md).
