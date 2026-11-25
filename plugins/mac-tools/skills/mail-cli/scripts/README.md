# mailctl

macOS Mail.app을 osascript(JXA)로 읽고, 검색하고, 옮기는 CLI. **보내기 기능 없음.**

- `mailctl` — Python 3 (표준 라이브러리만), 인자 파싱·출력, `.emlx` 본문 검색
- `mail_db.py` — Mail.app 내부 SQLite 인덱스(`~/Library/Mail/V*/MailData/Envelope Index`)를 읽기 전용으로 읽는 목록·검색 백엔드
- `mail_core.js` — JXA 코어. 읽기(`read`), 이동, 상태 변경과 DB를 못 읽을 때의 대체 경로. `osascript -l JavaScript mail_core.js '<json>'`로 호출되어 JSON을 돌려준다

위치: dotfiles `agents/.agents/skills/mail-cli/scripts/` (`~/.agents/skills/mail-cli`), PATH에는 `~/.local/bin/mailctl` 심볼릭 링크.

## 명령

| 명령 | 하는 일 |
|---|---|
| `accounts` | 계정, 주소, INBOX 전체/안읽음 수 |
| `mailboxes [-a 계정] [--counts]` | 계정별 메일함 (role: inbox/archive/trash/junk/sent/drafts 표시) |
| `count [-a] [-m]` | 메일함별 전체/안읽음 수와 합계 |
| `list` / `search` | 최신순 목록. 필터: `-q`(제목·보낸이), `--from`, `--subject`, `--body`(느림), `--since 7d`, `--before`, `--unread`, `--flagged`, `-n 20`, `--snippet`, `--refs` |
| `read REF [--headers] [--source]` | 메일 하나 보기 (본문 기본 4000자) |
| `archive REF…` | 계정의 보관 메일함으로 이동 (IMAP: Archive 폴더, Gmail: 휴지통을 거쳐 전체보관함) |
| `trash REF…` | 계정의 휴지통으로 이동 (Gmail: 휴지통, IMAP: Deleted Messages 등) |
| `inbox REF…` | INBOX로 되돌리기 |
| `move REF… --to 메일함` | 이름, role, 또는 `계정:메일함`으로 이동 |
| `mark read\|unread\|flag\|unflag REF…` | 상태 변경 |
| `senders` | 보낸이별 묶음 (정리 대상 찾기) |
| `unsubscribe [--scan 50]` | List-Unsubscribe 헤더가 있는 보낸이와 수신거부 링크 |

- 공통: `-a 계정`(이름 또는 주소, 쉼표로 여러 개), `-m 메일함`(이름, role, 쉼표 목록, `'*'` 전체), `--json`
- 이동 명령은 모두 `--dry-run`을 지원하고, refs 자리에 `-`를 주면 stdin에서 읽는다
- **REF** = `계정:메일함:id` (예: `Personal:INBOX:41666`, `Personal`은 Mail.app의 계정 이름) 또는 Message-Id. 이동하면 id가 바뀌므로 결과에 새 ref(`→ …`)를 출력한다
- Gmail은 같은 메일이 INBOX·전체보관함·중요에 같은 id로 보이므로, 검색 결과에서 계정+id 기준으로 한 줄로 합친다 (`alsoIn`)
- Gmail 전체보관함으로 옮길 때(`archive`, `move --to 전체보관함`)는 메일마다 INBOX → 휴지통 → 전체보관함으로 옮긴다. Mail.app에서 바로 옮기면 서버의 Inbox 라벨이 남아 다음 동기화 때 INBOX로 돌아온다. 휴지통에서 꺼낼 때 라벨이 모두 빠진다

## 예시

```bash
mailctl list -n 20                                   # 모든 계정 INBOX 최신 20개
mailctl list -a you@gmail.com --unread             # 계정 이름이나 주소로 지정
mailctl search --from vercel -m '*'                  # 모든 메일함
mailctl search -q "token policy" -m archive          # 보관된 메일에서 찾기
mailctl search --from vercel --refs | mailctl archive - --dry-run
mailctl senders -n 30                                # 카테고리 분류 전 보낸이 파악
mailctl unsubscribe --scan 100
```

## 백엔드

| 명령 | 기본 경로 | 대체 경로 |
|---|---|---|
| accounts, mailboxes, count, list, search, senders, unsubscribe | Envelope Index (SQLite, 읽기 전용) | JXA |
| read, archive, trash, inbox, move, mark | JXA (Mail.app) | — |

- `MAILCTL_BACKEND=db|jxa|auto` (기본 auto: DB를 못 읽으면 JXA), `MAILCTL_DEBUG=1`로 단계별 시간 표시.
- 계정 이름·주소는 DB에 없어서 JXA로 한 번 받아 `~/Library/Caches/mailctl/accounts.json`에 하루 캐시한다.
- DB 구조: `mailboxes.url = imap://<계정 UUID>/<경로>`, `messages`(ROWID = JXA id, mailbox, read, flagged, deleted, date_received),
  Gmail 라벨 메일함(INBOX, 중요 등)은 `labels` 테이블로 연결되고 실제 메시지는 전체보관함에 있다. Message-Id는 `message_global_data.message_id_header`.
- 2026-11-25에 모든 메일함의 메시지 id 집합과 메시지별 읽음 상태가 JXA와 일치함을 확인했다. 이동 직후 조회에도 바로 반영된다.
- `unread`는 메시지별 읽음 상태 기준이다. Mail 사이드바 배지(JXA `unreadCount`)는 더 작게 나올 수 있다.
- DB 스키마는 Apple이 문서화하지 않았다. macOS 업데이트 후 컬럼이 바뀌면 연결 검사에서 실패하고 JXA로 넘어간다.

## 성능 메모

- **목록·필터:** whose 필터 결과에서 속성을 읽으면 Mail이 속성마다 필터를 다시 돈다 (5,500통 메일함에서 속성당 약 11초).
  그래서 필터 없이 속성을 한 번에 받아(5,500통에 약 0.1초) JS에서 거른다.
- **본문 검색(`--body`):** Mail에 `content`를 물으면 메시지마다 본문을 파싱·렌더링해서 통당 약 0.7초 걸린다
  (apple-mail-mcp도 같은 방식으로 메시지마다 `content of aMessage`를 읽는 루프다).
  mailctl은 Mail이 디스크에 둔 `~/Library/Mail/V*/…/Messages/<id>.emlx`를 직접 파싱한다. 파일 이름이 JXA의 메시지 id와 같다.
  compat32 파서로 통당 약 0.7ms이고, 400통이 넘으면 프로세스 풀로 병렬 처리한다 (15,000통에 약 2초).
  `.emlx`가 없거나 못 읽는 메시지만 Mail.app `content()`로 확인한다.
  Spotlight는 Mail 본문을 색인하지 않는 경우가 있어 쓰지 않는다.
- **목록·검색 (DB):** 범위와 상관없이 약 0.2초 (`-m '*'` 검색이 JXA 20초 → 0.2초). 그중 약 0.15초는 Python 시작 시간이다.
