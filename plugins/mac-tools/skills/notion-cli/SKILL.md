---
name: notion-cli
description: Use when reading or acting on the Notion desktop app from the command line with `notionctl` — list or read a page's blocks, read images (as PNG), move blocks up/down, edit a block's text, append text blocks, upload an image, and work database views (list views, switch view, read rows, sort, search). Drives the running Notion app through the Chrome DevTools Protocol without bringing it to the front, no Notion API or MCP. Triggers: "노션", "Notion 페이지", "노션 블럭 이동", "노션 DB 뷰", "노션 정렬", "노션 사진", "notionctl".
metadata:
  version: "0.1.0"
  date: "2026-11-25"
---

# notion-cli (`notionctl`)

`notionctl` drives the running Notion desktop app (Electron) through the Chrome DevTools Protocol (CDP):
it reads the page DOM and sends mouse/key events straight into the page. **Notion stays in the background,
the real mouse and the system clipboard are not touched.** It does not use the Notion API or MCP.

- Command: `notionctl` (`~/.local/bin/notionctl` → `scripts/notionctl` in this skill, Node 24, no dependencies)
- Port: `127.0.0.1:9333` (override with `NOTIONCTL_PORT`)
- Image output: `~/Library/Caches/notionctl/` unless `-o` is given

## Preconditions

1. Notion must run **with the debugging port**. `notionctl status` tells. If it says "without the debugging
   port", ask the user before running `notionctl launch --yes`: it quits Notion and starts it again
   (tabs are restored). `notionctl launch --normal --yes` goes back to a normal start.
   While the port is open, any local program can control the logged-in Notion; mention that once.
2. The page must be **open in a Notion tab and rendered**. Restored tabs that were never clicked show as
   `(not loaded)` in `status`; ask the user to click that tab once. `notionctl` does not open pages.

## Commands

| Command | Access | Purpose |
|---|---|---|
| `notionctl status` | read | CDP on/off and open tabs (title, URL, loaded) |
| `notionctl blocks <page> [--all]` | read | Top-level blocks: number, short id, type, text (`--all` adds nested blocks) |
| `notionctl read <page>` | read | Page as Markdown-ish text (images as links, databases with views) |
| `notionctl image list <page>` | read | Image blocks with size |
| `notionctl image read <page> [n\|id] [-o file.png]` | read | Capture the image at its natural size; then open the PNG with Read |
| `notionctl screenshot <page> [-o file.png]` | read | Capture the visible page |
| `notionctl db list <page>` | read | Databases on the page: layout, rows, views (`*` = active) |
| `notionctl db rows <page> [--db N]` | read | Rows of the active view (table: header + cells; board: cards per column) |
| `notionctl db view <page> <view> [--db N]` | UI | Switch the shown view (also views hidden under "N more…") |
| `notionctl db search <page> "<text>" [--db N]` | UI | Database search box; `""` clears it |
| `notionctl db sort <page> <property> [asc\|desc] [--db N] --yes` | write | Replace the view's sorts with one rule |
| `notionctl db sort <page> --clear --yes` | write | Remove all sorts of the view |
| `notionctl move <page> <block> up\|down [-n N] --yes` | write | Move a top-level block |
| `notionctl edit <page> <block> "<text>" --yes` | write | Replace a block's text |
| `notionctl append <page> "<text>" [--after <block>] --yes` | write | New text block(s) after a text block (default: last text block); `\n` makes more blocks |
| `notionctl image add <page> <file> [--after <block>] --yes` | write | Upload png/jpg/gif/webp as an image block |

- `<page>`: a Notion URL, page id (32 hex, dashes optional) or a tab title (exact, else substring).
- `<block>`: the number `blocks` prints, an id prefix/suffix (6+ hex, e.g. `f9dd36e0`), or text (exact, else unique substring).
- Write commands without `--yes` only print what they would do. `--json` on any command.

## Rules

- Reads, `db view`, `db search` need no confirmation (they only change what this Notion window shows).
- **Before any write (move, edit, append, image add, db sort, launch), show the user the exact page, block
  and text and get an explicit OK**, unless the user's message already named them. Then run with `--yes`
  and report the block list or rows the command prints.
- `db sort` changes the shared view for everyone in the workspace; say so when proposing it.
- Run commands one at a time on a page (each one clicks and types inside it). Do not run them while the
  user is typing in the same Notion tab.
- After `image read`, open the PNG with Read to look at it.
- Only touch the pages the user asked about. Other open tabs (personal pages) are visible to CDP; do not read them.

## Limits

- Only blocks Notion has rendered are visible. Very long pages may need the user to scroll; databases show
  the rows the current view has loaded.
- `move` uses Notion's Cmd+Shift+↑/↓ from a text caret. Notion ignores that shortcut on a selected image or
  database, so those are moved by moving their text neighbour the other way; two non-text blocks next to
  each other cannot be swapped, and a text block moves past consecutive images in one step.
- `append` writes plain text (no Markdown shortcuts). Rich formatting, other block types, deleting blocks,
  filters, properties of database rows and opening pages are not supported yet.
- Images are read by screen capture of the rendered image (Notion blocks direct downloads from the page).
- Notion UI changes can break the selectors (`.notion-page-content`, `[data-block-id]`,
  `[data-content-editable-leaf]`, `[role=tab]`, `[aria-label="Sort"]`, overlay `[role=option|menuitem]`).
  Update them in `scripts/notionctl` when that happens.

## Recipes

```bash
notionctl status                                   # 디버깅 포트, 열린 탭
notionctl blocks ctl                               # 블럭 목록(번호·id·종류·글)
notionctl move ctl "Block C" up --yes              # 블럭 위로 한 칸
notionctl image read ctl 1 -o /tmp/n1.png          # 사진 1번을 PNG로 → Read로 보기
notionctl db view ctl "By Status"                  # DB 뷰 전환
notionctl db sort ctl "Due date" desc --yes        # 최신순 정렬(공유 뷰 변경)
notionctl db rows ctl                              # 지금 뷰의 행
```
