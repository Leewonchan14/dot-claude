---
name: kakao-cli
description: Use when reading or acting on the KakaoTalk Mac app from the command line with `kakaoctl` — chat list, chats with unread messages, recent messages of a chat room (including group chats with sender names), sending a message, opening and closing chat windows. Works through macOS Accessibility; reading and sending stay in the background, opening a room briefly activates KakaoTalk. Triggers: "카톡", "카카오톡", "카톡 안 읽은", "카톡 보내", "나와의 채팅", "kakaotalk", "kakaoctl".
metadata:
  version: "0.1.0"
  date: "2026-11-25"
---

# kakao-cli (`kakaoctl`)

`kakaoctl` drives the running KakaoTalk Mac app (native AppKit) through the macOS Accessibility API.
KakaoTalk's message database is encrypted, so everything is read from what the app shows.

- Command: `kakaoctl` (`~/.local/bin/kakaoctl` → `scripts/kakaoctl` in this skill)
- Code: `scripts/kakaoctl` (Python CLI), `scripts/kakao_ax.swift` (AX helper, compiled with `swiftc`
  on first run into `~/Library/Caches/kakaoctl/`)

## Preconditions

1. KakaoTalk is running and logged in, with its main window (title `카카오톡`) open on the **채팅** tab.
   Behind other apps is fine. If it is hidden or closed, `kakaoctl show` brings it back.
2. The screen is unlocked. While the Mac is locked, macOS hides app windows from Accessibility and
   every command fails with "the screen is locked".
3. The terminal running the agent has **Accessibility** permission (System Settings → Privacy & Security → Accessibility).
4. `swiftc` is available (Xcode Command Line Tools) for the first run.

## Commands

| Command | Access | Focus | Purpose |
|---|---|---|---|
| `kakaoctl status` | read | background | Main window, open chat windows, hidden/front state |
| `kakaoctl chats [-n 30]` | read | background | Chat list, newest first: name, members, time, last message, unread count, pinned/muted |
| `kakaoctl unread [-n 60]` | read | background | Chats with unread messages among the first n rows |
| `kakaoctl read <chat> [-n 20] [--mark-read]` | read | background if the room is open, else brief activation | Recent messages: time, sender, text, unread count of your messages |
| `kakaoctl open <chat> [--mark-read]` | state | brief activation | Open a chat window |
| `kakaoctl send <chat> "<text>" --yes` | write | background if the room is open, else brief activation | Send a message |
| `kakaoctl close <chat>\|all` | state | background | Close one or every chat window |
| `kakaoctl show` / `hide` | state | brief activation if the main window must be reopened | Unhide/reopen or hide KakaoTalk |

- `<chat>`: exact chat name as in the list (`가족, 친구`), a unique prefix, or `@me` for 나와의 채팅.
- `--json` on any command. Write commands without `--yes` only print what they would do.
- "Brief activation": KakaoTalk only opens a room while it is the active app, so `kakaoctl` activates it for
  about 0.7 s and gives focus back to the previous app. Avoid it while the user is typing elsewhere.

## Rules

- Reads of the chat list and of rooms that are already open need no confirmation.
- **Opening a room marks its unread messages read** (the other people see the "1" disappear). `read`/`open`
  refuse a room with unread messages unless `--mark-read` is given. Use `chats`/`unread` (last message
  preview) first, and pass `--mark-read` only when the user wants the room opened.
- Close chat windows you opened (`kakaoctl close <chat>`) when you are done, unless the user wants them open.

## Limits

- `chats` costs about 30 ms per row (KakaoTalk answers each AX call in ~3–5 ms), so it reads the first n rows
  (newest first). `-n 0` reads every chat (several seconds for a few hundred chats).
- `read` sees only what the open window has loaded (the recent part of the room); older history needs
  scrolling, which is not supported.
- Date separators carry no text in Accessibility, so messages show only their time (오전/오후 h:mm).
  Photos and emoticons appear as `[사진/이모티콘]`; their content is not readable.
- Whether a message is yours comes from its horizontal position (right side), and a sender name is shown only
  on the first message of a run, so `kakaoctl` carries it over to the following messages.
- Two chats with the same name are rejected as ambiguous.
- KakaoTalk UI changes can break the layout assumptions (chat-list row order, `전송` button, `메시지 입력` area).
  Update `parse_row`/`parse_messages` in `scripts/kakaoctl` and `scripts/kakao_ax.swift` when that happens.

## Recipes

```bash
kakaoctl unread                              # 안 읽은 채팅방
kakaoctl chats -n 15                         # 최근 채팅방 15개
kakaoctl read @me -n 10                      # 나와의 채팅 최근 10개
kakaoctl read "가족, 친구" --mark-read        # 안 읽은 게 있어도 열어서 읽기
kakaoctl send @me "메모" --yes
kakaoctl close all
```
