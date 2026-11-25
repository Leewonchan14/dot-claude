---
name: slack-cli
description: Use when reading or acting on the Slack desktop app from the command line with `slackctl` — unread conversations, recent messages of a channel or DM, threads, Activity notifications (list, mark read/unread), scheduled messages (list, schedule at an exact minute, reschedule, delete), sending, thread replies, editing your own messages, forwarding. Works through macOS Accessibility without bringing Slack to the front. Triggers: "슬랙", "Slack 메시지", "안 읽은 메시지", "슬랙 알림", "예약 메시지", "스레드 답장", "slack unread".
metadata:
  version: "0.1.0"
  date: "2026-11-25"
---

# slack-cli (`slackctl`)

`slackctl` drives the running Slack desktop app through the macOS Accessibility API: it reads what
Slack renders and clicks, types and opens menus inside it. Clicks are AX actions and keystrokes are
posted only to Slack's process, so **Slack stays in the background and the mouse does not move**.

- Command: `slackctl` (`~/.local/bin/slackctl` → `scripts/slackctl` in this skill)
- Code: `scripts/slackctl` (Python CLI), `scripts/slack_ax.swift` (AX helper, compiled with `swiftc`
  on first run into `~/Library/Caches/slackctl/`)

## Preconditions

1. Slack is running **with its window open** (minimized or behind other apps is fine; a closed window is not).
   If `slackctl` says "no Slack window is open", ask the user to open Slack's window.
2. The terminal running the agent has **Accessibility** permission (System Settings → Privacy & Security → Accessibility).
3. `swiftc` is available (Xcode Command Line Tools) for the first run.

## Commands

| Command | Access | Purpose |
|---|---|---|
| `slackctl status` | read | Current Slack view and "N new items" |
| `slackctl unread` | read | Conversations with unread messages (+ Threads) |
| `slackctl channels [--unread]` | read | Sidebar conversations: name, kind, id |
| `slackctl read <conv> [-n 20]` | read | Recent messages with time, sender, text, ts, reply count |
| `slackctl thread <conv> <ts>` | read | All messages of a thread |
| `slackctl activity [--unread] [--tab all\|dms\|mentions\|threads] [-n 30]` | read | Notifications (Activity), with item ids |
| `slackctl activity mark <item-id> read\|unread` | state | Mark one notification read/unread |
| `slackctl scheduled` | read | Scheduled messages |
| `slackctl send <conv> "<text>" [--thread <ts>] --yes` | write | Send a message or a thread reply |
| `slackctl schedule <conv> <HH:MM> "<text>" --yes` | write | Schedule for an exact minute **today** |
| `slackctl scheduled reschedule <n\|id> <HH:MM> --yes` | write | Change a scheduled time |
| `slackctl scheduled delete <n\|id> --yes` | write | Delete a scheduled message |
| `slackctl edit <conv> <ts> "<text>" [--thread <parent-ts>] --yes` | write | Edit one of your messages |
| `slackctl forward <conv> <ts> --to <name\|@me> [--comment "…"] --yes` | write | Forward a message |

- `<conv>`: channel name (`general`, `#general`), person (`@alex`, prefix match), `@me` for your own DM, or an ID (`C…`/`D…`).
- `<ts>`: the message timestamp `slackctl read`/`thread` prints (`ts=1700000000.123456`).
- Write commands without `--yes` only print what they would do. `--json` on any command.

## Rules

- Reads and `activity mark` need no confirmation.
- **Before any write (send, schedule, reschedule, delete, edit, forward), show the user the exact
  conversation, time and text and get an explicit OK**, unless the user's message already gave the exact
  text and target. Then run with `--yes` and report what Slack shows afterwards.
- Write in the language of the conversation. English speakers get English; if the
  user dictates Korean for an English thread, translate it and show the translation first.
- Do not bring Slack to the front, do not move the mouse, and do not use `open slack://…` deep links
  (they activated Slack once). After a command, leave Slack on whatever view it ended on; do not
  navigate back to a previous channel.
- Never post in a channel when the user asked for a thread reply. Thread replies are not also sent to the channel.

## Limits

- Only messages Slack has rendered are visible (the recent part of a channel). Older history needs scrolling,
  which is not supported. On Slack's free plan, messages older than 90 days are locked.
- Opening a conversation from the background does not mark it read in Slack.
- `schedule` takes a time today at least 2 minutes ahead; Slack rejects closer times. Other days are not supported yet.
- `forward --to` can only pick from Slack's suggestion list (recent conversations), because typed search text
  does not reach Slack's search. If the target is missing, the command lists what was offered.
- `edit` / `forward` / `send --thread` need the target message to be rendered (recent).
- Slack UI changes can break the selectors (DOM classes such as `p-channel_sidebar__channel`, `ql-editor`,
  `p-schedule_message__time_picker`). Update them in `scripts/slackctl` when that happens.

## Recipes

```bash
slackctl unread                                   # 안 읽은 대화
slackctl activity --unread                        # 안 읽은 알림
slackctl read general -n 10                       # 최근 메시지 10개
slackctl thread general 1700000000.123456         # 스레드 전체
slackctl send general "Thanks!" --thread 1700000000.123456 --yes
slackctl schedule @me 14:05 "reminder text" --yes
slackctl scheduled reschedule 1 14:30 --yes
```
