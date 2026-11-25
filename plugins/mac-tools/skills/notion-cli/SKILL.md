---
name: notion-cli
description: Use when reading or acting on the Notion desktop app from the command line with `notionctl` — list and switch workspaces (several accounts), open a page by URL or follow a sub-page link, search pages (Notion's quick find, or the local cache offline), list or read a page's blocks (whole page incl. tables, also pages not open in a tab), read images (original files), move blocks up/down, edit a block's text, append text blocks, upload an image or any file (PDF, docx, …) as a block, delete a block, and work database views (list views, switch view, read every row with its properties, sort, search). Also for Notion pages the Notion MCP cannot reach (another workspace, guest pages). Drives the running Notion app through the Chrome DevTools Protocol without bringing it to the front, no Notion API or MCP. Triggers: "노션", "Notion 페이지", "노션 검색", "노션 워크스페이스", "워크스페이스 전환", "노션에 올려", "노션 파일 업로드", "노션 PDF", "노션 블럭 이동", "노션 블럭 삭제", "노션 DB 뷰", "노션 정렬", "노션 사진", "notionctl".
metadata:
  version: "0.4.0"
  date: "2026-11-25"
---

# notion-cli (`notionctl`)

`notionctl` drives the running Notion desktop app (Electron) through the Chrome DevTools Protocol (CDP):
reads go through Notion's own web API from inside a loaded tab (`/api/v3`, the tab's cookies, nothing leaves
the app), writes send mouse/key events straight into the page. **Notion stays in the background, the real
mouse and the system clipboard are not touched.** It does not use the public Notion API or MCP.

- Command: `notionctl` (`~/.local/bin/notionctl` → `scripts/notionctl` in this skill, Node 24, no dependencies)
- Port: `127.0.0.1:9333` (override with `NOTIONCTL_PORT`)
- Image output: `~/Library/Caches/notionctl/` unless `-o` is given

## Preconditions

1. Notion must run **with the debugging port**. `notionctl status` tells. If it says "without the debugging
   port", ask the user before running `notionctl launch --yes`: it quits Notion and starts it again
   (tabs are restored). `notionctl launch --normal --yes` goes back to a normal start.
   While the port is open, any local program can control the logged-in Notion; mention that once.
2. **Reads** (`blocks`, `read`, `image list|read`, `db list|rows`, `search`) need only one loaded Notion tab: a page
   given by URL or id is read through the API even when no tab shows it. **Writes and UI commands** need the
   page open in the tab Notion **shows** (a background tab has no layout and does not take keys; the command
   says so). `notionctl open <url|id>` loads a page into the blank tab
   (or `--in <tab>`, which makes that tab leave its page), and `notionctl open <tab> <block>` follows a
   sub-page link inside an open page. Other restored tabs that show `(not loaded)` need one click in Notion.
3. **Notion MCP vs notionctl:** the Notion MCP is connected to one workspace. A page in another workspace
   (for example a personal or guest workspace) gives 404 `object_not_found` there and does not show up
   in its search. Ask the user for the link and read it with notionctl (the API call tries every signed-in
   account), or find it with `notionctl search`.

## Commands

| Command | Access | Purpose |
|---|---|---|
| `notionctl status` | read | CDP on/off and open tabs (title, URL, loaded) |
| `notionctl workspace` | UI | Accounts and their workspaces from the sidebar switcher (`*` = current, guest marked); opens and closes the menu |
| `notionctl workspace <name> [--account <email>] [--in <tab>]` | UI | Switch the shown tab to that workspace (its last page opens); `--account` picks between same-named workspaces |
| `notionctl open <url\|id> [--in <tab>]` | UI | Load a page into the blank tab (or the given tab); "already open" if a tab shows it |
| `notionctl open <page> <block>` | UI | Follow the sub-page link in that block (same tab) |
| `notionctl search "<text>" [--limit N] [--in <tab>]` | read | Notion's quick find in the workspace of a loaded tab (`--in` picks the tab, so the workspace): title, URL, snippet |
| `notionctl search "<text>" --local [--limit N]` | read | Search the app's local cache (`notion.db`, read-only) across all workspaces; no debugging port needed; only pages this Mac has opened, may lag |
| `notionctl blocks <page> [--all] [--visible]` | read | Top-level blocks of the whole page through the API: number, short id, type, text (`--all` adds nested blocks and table rows, `--visible` only what the shown tab renders now) |
| `notionctl read <page> [--visible]` | read | Page as Markdown (tables as Markdown tables, links, code languages, sub-pages with URLs, databases with views) |
| `notionctl image list <page>` | read | Image blocks: shown size and file name |
| `notionctl image read <page> [n\|id] [-o file] [--capture]` | read | Download the original file (png/jpg/gif/webp, real pixel size); `--capture` screen-captures the rendered image instead (shown tab only). Then open the file with Read |
| `notionctl screenshot <page> [-o file.png]` | read | Capture the visible page |
| `notionctl db list <page>` | read | Databases on the page: layout, rows, views (`*` = active; rows and `*` only when the shown tab renders it) |
| `notionctl db rows <page> [--db N] [--view <name>] [--limit N]` | read | Every row of the active (or named) view with its view's filter and sort, through the API: visible properties as columns (people as names, relations as titles, dates, times); board: cards per group. Default limit 100. Formula/rollup values are computed by the app and come out empty |
| `notionctl db view <page> <view> [--db N]` | UI | Switch the shown view (also views hidden under "N more…") |
| `notionctl db search <page> "<text>" [--db N]` | UI | Database search box; `""` clears it |
| `notionctl db sort <page> <property> [asc\|desc] [--db N] --yes` | write | Replace the view's sorts with one rule |
| `notionctl db sort <page> --clear --yes` | write | Remove all sorts of the view |
| `notionctl move <page> <block> up\|down [-n N] --yes` | write | Move a top-level block |
| `notionctl edit <page> <block> "<text>" --yes` | write | Replace a block's text |
| `notionctl append <page> "<text>" [--after <block>] --yes` | write | New text block(s) after a block (default: the last block); `\n` makes more blocks |
| `notionctl image add <page> <file> [--after <block>] --yes` | write | Upload png/jpg/gif/webp as an image block (grey placeholder first; waits up to 120 s) |
| `notionctl file add <page> <file> [--after <block>] --yes` | write | Upload any file (pdf, docx, xlsx, zip, …) as a file block with its own name; waits until "Uploading" is gone |
| `notionctl delete <page> <block> --yes` | write | Delete a block through its handle menu (a page block goes to Trash) |

- `<page>`: a Notion URL, page id (32 hex, dashes optional) or a tab title (exact, else substring).
- `<block>`: the number `blocks` prints, an id prefix/suffix (6+ hex, e.g. `f9dd36e0`), or text (exact, else unique substring).
- Write commands without `--yes` only print what they would do. `--json` on any command.
- `NOTIONCTL_DOM=1` reads by scrolling the rendered page instead of the API (the old way); `NOTIONCTL_DEBUG=1`
  prints timings and API fallbacks on stderr.

## Rules

- Reads, `db view`, `db search` need no confirmation (they only change what this Notion window shows).
- `open` and `workspace <name>` change what a tab shows: say which tab. Switching a workspace only changes
  that tab; other tabs keep their pages.
- **Before any write (move, edit, append, image add, file add, delete, db sort, launch), show the user the exact page, block
  and text and get an explicit OK**, unless the user's message already named them. Then run with `--yes`
  and report the block list or rows the command prints.
- `db sort` changes the shared view for everyone in the workspace; say so when proposing it.
- Run commands one at a time on a page (each one clicks and types inside it). Do not run them while the
  user is typing in the same Notion tab.
- After `image read`, open the PNG with Read to look at it.
- Only touch the pages the user asked about. Other open tabs (personal pages) are visible to CDP; do not read them.

## Limits

- Reads use Notion's internal web API (`loadPageChunk`, `queryCollection`, `search`, `getSignedFileUrls`),
  which is not a public contract. When it fails, `blocks`/`read` fall back to scrolling the rendered page
  (Notion renders only the blocks near the scroll position; that is slower and misses table cells).
- After a write, the command waits until the server copy shows the change (up to ~8 s) and prints that; if it
  does not, it prints what the page renders.
- Before every click the target point is hit-tested: if another element covers the block there, nothing is
  clicked and the command stops.
- Where a new block goes (`append`, `image add`, `file add`): after a text-like block, Enter at its end.
  After a file/image/page block, Enter at the start of the **next text block**, which makes an empty block
  above it. A page that ends in a non-text block, or two non-text blocks in a row, cannot get a block in
  between: clicking below the last block and the hover "+" do nothing over CDP. Ask the user to add an
  empty line there first.
- `workspace` clicks the sidebar switcher, so it works only on the tab Notion is showing (background tabs
  have no layout: `innerWidth` 0). Without `--in` it picks the shown tab. `Page.bringToFront` does not
  change Notion's shown tab. Long menus scroll; the item is scrolled into view before the click.
- Uploads are a paste of the file into the empty block (`ClipboardEvent` with a `File`), like dropping it.
- `move` uses Notion's Cmd+Shift+↑/↓ from a text caret. Notion ignores that shortcut on a selected image or
  database, so those are moved by moving their text neighbour the other way; two non-text blocks next to
  each other cannot be swapped, and a text block moves past consecutive images in one step.
- `append` writes plain text (no Markdown shortcuts). Rich formatting, other block types and editing
  database row properties are not supported yet.
- `image read` downloads the original file through a signed file URL; `--capture` (or a failed download) falls
  back to a screen capture of the rendered image in the shown tab.
- Notion UI changes can break the selectors (`.notion-page-content`, `[data-block-id]`,
  `[data-content-editable-leaf]`, `[role=tab]`, `[aria-label="Sort"]`, overlay `[role=option|menuitem]`).
  Update them in `scripts/notionctl` when that happens.

## Recipes

```bash
notionctl status                                   # 디버깅 포트, 열린 탭
notionctl search "screen control"                  # 지금 워크스페이스 빠른 검색
notionctl search "큐비" --local                    # 로컬 캐시 검색(모든 워크스페이스)
notionctl read https://app.notion.com/p/<id>       # 탭에 안 열린 페이지도 읽기
notionctl db rows <db-page-id> --view Archived --limit 50   # 뷰의 모든 행과 속성
notionctl workspace                                # 계정·워크스페이스 목록
notionctl workspace "Team space" --account work@    # 보이는 탭을 그 워크스페이스로
notionctl open https://app.notion.com/p/<id>        # 링크로 페이지 열기(빈 탭)
notionctl open "Parent page" "Child page"           # 하위 페이지로 들어가기
notionctl blocks ctl                               # 블럭 목록(번호·id·종류·글), 페이지 전체
notionctl file add ctl ./a.pdf --after "Block C" --yes   # PDF를 파일 블럭으로
notionctl delete ctl a.pdf --yes                   # 블럭 삭제
notionctl move ctl "Block C" up --yes              # 블럭 위로 한 칸
notionctl image read ctl 1                         # 사진 1번 원본 파일 → Read로 보기
notionctl db view ctl "By Status"                  # DB 뷰 전환
notionctl db sort ctl "Due date" desc --yes        # 최신순 정렬(공유 뷰 변경)
notionctl db rows ctl                              # 지금 뷰의 행
```
