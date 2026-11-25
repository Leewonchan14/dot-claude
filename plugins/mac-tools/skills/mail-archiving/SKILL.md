---
name: mail-archiving
description: The user's own rules for archiving, moving and tidying Mail.app mail with mailctl. Use together with mail-cli whenever the user says 아카이브/아카이빙/보관/archive, "정리해줘" about mail, "All Mail로", "휴지통으로", asks to move mail between mailboxes, or asks to 정리/요약해서 파일로 만들어 about mail. Covers which mailbox is the archive per account, what needs approval, dry-run first, ids after moves, result limits, Markdown summaries, and raw-source reads.
metadata:
  version: "1.1.0"
  date: "2026-11-25"
---

# 메일 아카이빙 규칙

사용자가 정한 메일 관리 규칙을 `mailctl`(mail-cli 스킬)에 맞게 정리한 것이다.
명령 사용법은 mail-cli 스킬을 본다. 이 문서는 **무엇을 어떤 순서로, 무엇을 묻고 해야 하는지**를 정한다.
규칙이 충돌하면 번호가 작은 규칙이 우선한다.

## 1. Mail 조작은 `mailctl`로만 한다

- 메일 조회·이동·상태 변경은 `mailctl` 명령으로만 한다.
- `osascript`, `tell application "Mail"`, JXA, `do shell script` 같은 Apple Events를 직접 작성해 실행하지 않는다.
  `mailctl`이 내부에서 쓰는 JXA만 허용된다. `mailctl`로 안 되는 작업이면 멈추고 사용자에게 알린다.
- 메일 앱 데이터 파일(`~/Library/Mail`)에 쓰지 않는다. `mailctl`도 읽기만 한다.

## 2. 아카이빙 명령 처리

### 2-1. 명령 분류

| 사용자 표현 | 처리 |
|---|---|
| "All Mail로 이동해줘", "Gmail 아카이브로 보내줘", "모든 메일함으로 옮겨줘" | **2-3** Gmail 전체보관함으로 이동 |
| "아카이빙해줘", "보관해줘", "archive해줘", "보관함으로 옮겨줘", 메일 이동 맥락의 "정리해줘" | **2-2** 계정의 보관 메일함 우선 |
| 요약·문서 맥락의 "정리해줘", "파일로 만들어줘" | **7** Markdown 파일 |

대상은 따로 말하지 않으면 **INBOX에 있는 메일**이다.

### 2-2. 일반 아카이빙: 보관 메일함 우선

1. 계정마다 보관 메일함이 있는지 찾는다. `mailctl archive`가 아래 순서로 고른다:
   `Archive` → `Archives` → `보관함` → `보관` → `Saved` → `Save` → (없으면) Gmail `전체보관함`/`All Mail`.
   확인만 할 때는 `mailctl mailboxes -a 계정`으로 `[archive]` 표시를 본다.
2. 실행 전에 계정별 목적지를 사용자에게 알린다.
   - 보관 폴더가 있으면: "📁 '{폴더}' 폴더를 찾았습니다. 이곳으로 아카이빙을 진행합니다."
   - 없으면(Gmail): "📁 별도의 Archive 폴더가 없습니다. Gmail의 전체보관함(All Mail)으로 아카이빙합니다."
3. 동의 절차 없이 진행한다(아카이빙은 승인 불필요, 3장). 단 대상을 필터로 골랐으면 4장의 dry-run을 먼저 한다.
4. 보관 폴더가 있는데 전체보관함으로 보내지 않는다. 확인하지 않고 추측으로 폴더를 고르지 않는다.

계정별 목적지는 대개 이렇다. 실제 값은 `mailctl accounts`와 `mailctl mailboxes -a 계정`으로 확인한다.

| 계정 종류 | 보관 메일함 |
|---|---|
| IMAP (보관 폴더 있음) | `Archive` 등 |
| Gmail / Google Workspace | `전체보관함` (`All Mail`) |

### 2-3. Gmail 전체보관함(All Mail)으로 보내기

- `mailctl archive REF…`(보관 폴더가 없는 Gmail 계정) 또는 `mailctl move REF… --to 전체보관함`을 쓴다.
  mailctl이 그 메일만 **INBOX → 휴지통 → 전체보관함** 순서로 옮긴다. 출력에 `(via 휴지통)`이 붙는다.
- 받은 편지함에서 전체보관함으로 **바로** 옮기면 서버의 Inbox 라벨이 남아, 15초쯤 뒤 동기화 때 INBOX로 돌아온다.
  그래서 휴지통을 거친다. 메일을 하나씩 지정해서 옮기므로 원래 휴지통에 있던 다른 메일은 건드리지 않는다.
- 옮긴 뒤 1분쯤 지나서 INBOX와 휴지통을 다시 검색해 확인한다:
  `mailctl search --from 보낸이 -m inbox,휴지통 -a 계정`. 휴지통에 남아 있으면
  `mailctl move <휴지통 ref> --to 전체보관함`으로 한 번 더 옮긴다. 휴지통 메일은 30일 뒤 지워지므로 그대로 두지 않는다.

## 3. 승인

승인 없이 해도 되는 것:
- 조회: `accounts`, `mailboxes`, `count`, `list`, `search`, `read`, `senders`, `unsubscribe`, 원문 조회
- 사용자가 직접 지시한 이동(`move`, `inbox`, `trash`로 휴지통 이동 포함)
- 아카이빙(`archive`, 2장)

먼저 물어야 하는 것:
- 읽음 상태 변경(`mark read|unread`), 플래그 변경(`mark flag|unflag`)
- 영구 삭제, 휴지통 비우기, 임시보관함 삭제, 메일함 생성·삭제·이름 변경 (`mailctl`에 없음. 요청받으면 할 수 없다고 말한다)
- 메일 발송·답장·전달 (`mailctl`에 없음)

승인 요청 형식:

```
📌 다음 작업을 실행하려면 승인이 필요합니다:
   작업: [작업 내용]
   대상: [메일 제목 또는 ref]
   계정: [계정명]
   진행할까요?
```

## 4. 실행 절차 (이동·아카이빙 공통)

1. 대상을 정한다. 보낸이·카테고리로 고를 때는 `mailctl search … -m inbox`로 찾는다.
   - 같은 서비스의 다른 발신 주소도 포함한다. 예: "vercel"이면 `vercel[bot]`(GitHub 알림)도 Vercel로 본다.
2. 필터로 고른 대상은 `--dry-run`으로 먼저 보여 준다: `mailctl search --from vercel --refs | mailctl archive - --dry-run`.
   사용자가 ref를 직접 보고 고른 경우에는 바로 실행해도 된다.
3. 아직 할 일이 남은 메일은 빼고, 뺀 이유를 알린다. 예: 아직 열려 있는 PR 알림, 답장이 필요한 메일, 일정 초대.
4. 실행한다. 결과는 계정별 건수와 카테고리별 건수로 보고한다.
5. 원래 휴지통·보관함에 있던 메일은 건드리지 않는다. 범위는 항상 출발 메일함(기본 INBOX)으로 한정한다.

## 5. 이동 후 ref 다시 쓰기

- 메일을 옮기면 id가 바뀐다. `mailctl`이 출력하는 새 ref(`→ Personal:Archive:41680`)를 쓴다.
- 이동 전에 얻은 ref를 다시 쓰지 않는다. 새 ref를 모르면 `mailctl search`나 Message-Id(`mailctl read <Message-Id>`)로 다시 찾는다.
  Message-Id는 이동해도 바뀌지 않는다.

## 6. 결과 수 제한

- 조회·검색은 기본 **20건**(`-n 20`, mailctl 기본값)이다.
- 더 보여 달라고 하면 20건씩 나눠 보여 주겠다고 제안한다. 사용자가 더 큰 수를 직접 말했을 때만 늘린다.
- 이동 대상 자체를 20건으로 자르지는 않는다. 다만 dry-run 목록이 길면 계정·보낸이별로 묶어 보여 준다.

## 7. "정리해줘 / 파일로 만들어줘" → Markdown 파일

트리거: "정리해줘"(요약 맥락), "파일로 만들어줘/저장해줘", "문서로 만들어줘", "markdown으로 정리해줘", "요약 파일 만들어줘", "~.md 파일로".

1. 내용을 Markdown으로 구조화한다. 메일 목록이면 카테고리별 제목과 건수, 한 줄에 `제목 — 보낸이 (계정 · MM/DD)`.
2. 의미 있는 파일 이름을 쓴다: `inbox_summary_YYYY-MM-DD.md`, `inbox_categorized_YYYY-MM-DD.md`, `email_rules.md` 등. `untitled.md` 같은 이름 금지.
3. 사용자가 경로를 말하지 않았으면 현재 작업 디렉터리에 저장한다.
4. 저장한 전체 경로를 알려 준다. 파일로 달라고 했는데 화면에만 출력하지 않는다.

## 8. 원문(헤더·MIME) 조회

- 인코딩, 스팸 판정, 인증 결과, 스레드, 숨은 링크를 볼 때만 원문을 본다.
- 헤더만으로 충분하면 `mailctl read REF --headers`, 전체 원문은 `mailctl read REF --source --max-bytes 65536` (기본 64KB, 그 이상은 이유가 있을 때만).
- 대상은 Message-Id로 지정하는 것을 우선한다: `mailctl read '<id@domain>'`. 내부 숫자 id(ref의 마지막 숫자)와 Message-Id를 혼동하지 않는다.

## 목록·분류 보고 형식

- 먼저 총 건수와 계정별 건수: "INBOX에 62통 (Work 23, Personal 25, Side 14)".
- 카테고리별로 묶는다. 카테고리 예: GitHub(열린 PR), 협업 도구 멘션·댓글, 이슈 트래커, 회사 공지, 일정 초대,
  쇼핑·결제·영수증, 뉴스레터·마케팅, 보안·계정 알림, 금융·보험, 게임, 개발 알림.
- 할 일이 있어 보이는 메일에는 ⚠️를 붙인다.
- 사용자는 이 목록을 보고 "notion, 쇼핑, 마케팅 아카이브해줘"처럼 카테고리 이름으로 지시한다. 그 카테고리에 넣었던 메일을 그대로 대상으로 쓴다.
