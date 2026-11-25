---
name: mail-cli
description: Use when reading, searching, triaging, archiving or moving mail in the macOS Mail.app accounts (Gmail, Google Workspace, IMAP) from the command line with `mailctl` — inbox counts, newest-N lists, per-category grouping, one-line summaries, search by sender/subject/body/date (including archived mail), archive/trash/move, unsubscribe candidates. Triggers: "메일 리스트업", "인박스 몇 개", "메일 분류", "메일 아카이브", "보관된 메일에서 찾아", "수신 거부할 메일", "Mail 앱", "mail inbox". No sending.
metadata:
  version: "0.4.0"
  date: "2026-11-25"
---

# mail-cli (`mailctl`)

`mailctl` reads Mail.app's own SQLite index for lists and searches (about 0.2 s for any scope),
parses local `.emlx` files for body text, and drives Mail.app through osascript (JXA) only for
`read`, `archive`/`trash`/`inbox`/`move` and `mark`. It cannot send mail.

- Command: `mailctl` (`~/.local/bin/mailctl` → `scripts/mailctl` in this skill)
- Code: `scripts/mailctl` (CLI), `scripts/mail_db.py` (Envelope Index reader), `scripts/mail_core.js` (JXA)
- Details and performance notes: `scripts/README.md`

## Preconditions

1. The terminal app running the agent has **Full Disk Access** (to read `~/Library/Mail`) and
   **Automation → Mail** permission. macOS asks for Automation on first use; grant Full Disk Access in System Settings → Privacy & Security.
2. If the index cannot be read, `mailctl` falls back to asking Mail.app over JXA (5–20 s for wide scopes).
   Force a backend with `MAILCTL_BACKEND=db|jxa`. `MAILCTL_DEBUG=1` prints timings.

## Commands

| Command | Access | Purpose |
|---|---|---|
| `mailctl accounts` | read | Accounts, addresses, INBOX total/unread |
| `mailctl mailboxes [-a ACC] [--counts]` | read | Mailboxes per account with role (inbox/archive/trash/junk/sent/drafts) |
| `mailctl count [-a ACC] [-m BOX]` | read | Total/unread per mailbox and sum |
| `mailctl list` / `mailctl search` | read | Newest first. Filters: `-q` (subject or sender), `--from`, `--subject`, `--body`, `--since 7d`, `--before`, `--unread`, `--flagged`, `-n 20`, `--snippet [N]`, `--refs` |
| `mailctl read REF [--headers] [--source]` | read | One message, body capped at 4000 chars |
| `mailctl senders` | read | Group by sender (count, unread, latest subject, refs) |
| `mailctl unsubscribe [--scan 50]` | read | Senders whose mail has List-Unsubscribe, with the link |
| `mailctl archive REF…` | write | Move to the account's archive (IMAP: `Archive` folder, Gmail: 전체보관함 via 휴지통) |
| `mailctl trash REF…` | write | Move to the account's trash (Gmail: 휴지통, IMAP: e.g. Deleted Messages) |
| `mailctl inbox REF…` | write | Move back to INBOX |
| `mailctl move REF… --to BOX` | write | Move to a mailbox name, role, or `Account:Mailbox` |
| `mailctl mark read\|unread\|flag\|unflag REF…` | write | Change state |

Common options: `-a` account name or address (comma list), `-m` mailbox name, role, comma list or `'*'`
(default `INBOX`), `--json`. Every write command takes `--dry-run` and `-` to read refs from stdin.

## Refs and ids

- REF = `Account:Mailbox:id` (e.g. `Personal:INBOX:41666`, where `Personal` is the account name in Mail.app) or a Message-Id.
- **Moving changes the id.** Write commands print the new ref (`→ Personal:Archive:41680`). Use that,
  or search again, before acting on the message a second time.
- Gmail shows one message in INBOX, 전체보관함 and 중요 with the same id. Results are merged into
  one row (`alsoIn` in JSON).
- Gmail archive (`archive`, or `move --to 전체보관함`) goes INBOX → 휴지통 → 전체보관함 for each message.
  A direct move leaves the server's Inbox label and the message is back in INBOX after the next sync.
  Check again after about a minute (`-m inbox,휴지통`); if it sits in 휴지통, move it to 전체보관함 again.
- `unread` counts messages whose read flag is off. Mail's sidebar badge can show a smaller number.

## Rules

Archiving, moving, approvals and "정리해줘" follow the **mail-archiving** skill (the user's own rules). Summary:

- Reads (`accounts`, `count`, `list`, `search`, `read`, `senders`, `unsubscribe`) need no confirmation.
- `archive`, `move`, `inbox` and `trash` run when the user asked for that move. When the targets come
  from a filter rather than refs the user saw, run with `--dry-run` first, show the list, then run it.
- `mark` (read/unread/flag) needs the user's explicit OK first.
- Default to 20 results (`-n 20`). Page or raise the limit only when asked.
- Never send, reply, forward, delete permanently, or empty the trash. `mailctl` has no such command.

## Output style the user expects

- One line per mail: `제목 — 보낸이 (계정 · MM/DD)`. This is what `mailctl list` prints.
- When asked to categorize, group into categories such as 쇼핑·결제·구독, 뉴스레터·마케팅, 회사·업무,
  금융·보험, 보안·계정, 개발 알림, and show counts per category.
- For one-sentence summaries, use `--snippet 200` and write one Korean sentence per mail.
- When asked to "정리해줘" into a file, write Markdown and give the path.

## Recipes

```bash
mailctl count                                        # 인박스 몇 개
mailctl list -n 20 --snippet 200 --json              # 리스트업 + 한줄 요약 재료
mailctl senders -n 30                                # 분류 전에 누가 보내는지
mailctl search --from vercel --refs | mailctl archive - --dry-run   # vercel 메일 아카이브 (확인 후 --dry-run 빼고)
mailctl search -q "token policy" -m archive          # 보관된 메일에서 찾기
mailctl search --body "결제" --since 2w -m '*'       # 본문 검색, 모든 메일함
mailctl unsubscribe --scan 100                       # 수신 거부 후보
mailctl read Personal:INBOX:41666                      # 본문 보기
```
