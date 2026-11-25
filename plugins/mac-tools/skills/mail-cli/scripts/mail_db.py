"""Read-only metadata backend for mailctl: Mail.app's own SQLite index.

~/Library/Mail/V*/MailData/Envelope Index holds every message's subject, sender, dates, read/flagged
state and mailbox, with the same ROWIDs that AppleScript/JXA reports as message ids. Reading it takes
milliseconds; asking Mail.app for the same data over Apple events takes seconds.

Layout used here (checked against JXA on 2026-11-25, every mailbox matched):
  mailboxes(ROWID, url='imap://<ACCOUNT-UUID>/<url-encoded path>', source)
  messages(ROWID, mailbox, sender->addresses, subject->subjects, subject_prefix,
           date_received (unix s), read, flagged, deleted, global_message_id)
  labels(message_id, mailbox_id)          Gmail label mailboxes (source = the All Mail box)
  message_global_data(ROWID, message_id_header)
A Gmail message lives in All Mail (messages.mailbox) and appears in INBOX/중요/... through labels.
"""
import glob
import json
import os
import sqlite3
import time
import unicodedata
import urllib.parse
from datetime import datetime, timezone

ROLES = {
    "inbox": ["INBOX", "Inbox", "받은편지함"],
    "archive": ["Archive", "Archives", "보관함", "보관", "Saved", "Save", "[Gmail]/Archive", "전체보관함", "All Mail"],
    "trash": ["휴지통", "Trash", "Deleted Messages", "Deleted Items", "지운편지함"],
    "junk": ["스팸함", "Junk", "Spam", "Junk E-mail"],
    "sent": ["보낸편지함", "Sent Messages", "Sent", "Sent Items"],
    "drafts": ["임시보관함", "Drafts"],
}
VIRTUAL = ["전체보관함", "all mail", "중요", "important", "별표편지함", "starred"]
CACHE = os.path.expanduser("~/Library/Caches/mailctl/accounts.json")


class Unavailable(Exception):
    pass


def nfc(s):
    return unicodedata.normalize("NFC", s or "")


def db_path():
    found = sorted(glob.glob(os.path.expanduser("~/Library/Mail/V*/MailData/Envelope Index")))
    if not found:
        raise Unavailable("Envelope Index not found")
    return found[-1]


def connect():
    try:
        con = sqlite3.connect("file:" + urllib.parse.quote(db_path()) + "?mode=ro", uri=True, timeout=5)
        con.execute("select ROWID, url, source from mailboxes limit 1").fetchall()
        con.execute("select ROWID, mailbox, sender, subject, subject_prefix, date_received, read, flagged, deleted, global_message_id from messages limit 1").fetchall()
        con.execute("select message_id, mailbox_id from labels limit 1").fetchall()
        con.execute("select ROWID, message_id_header from message_global_data limit 1").fetchall()
        return con
    except (sqlite3.Error, OSError) as e:
        raise Unavailable(f"cannot read Envelope Index: {e}")


class Store:
    def __init__(self, call_jxa):
        self.con = connect()
        self.boxes = {}
        for rid, url, src in self.con.execute("select ROWID, url, source from mailboxes"):
            u = urllib.parse.urlparse(url)
            path = nfc(urllib.parse.unquote(u.path.lstrip("/")))
            self.boxes[rid] = {"rid": rid, "acct": u.netloc, "path": path, "name": path.split("/")[-1], "source": src}
        self.accounts = self._accounts(call_jxa)

    # account names live only in Mail.app's prefs; cache them (one JXA call when unknown)
    def _accounts(self, call_jxa):
        uuids = {b["acct"] for b in self.boxes.values()}
        # The index also holds mailboxes of local/removed accounts; remember those UUIDs as non-accounts.
        try:
            with open(CACHE) as fh:
                cached = json.load(fh)
            known = set(cached["accounts"]) | set(cached.get("nonAccounts", []))
            if uuids <= known and time.time() - cached["at"] < 86400:
                return cached["accounts"]
        except (OSError, ValueError, KeyError):
            pass
        accs = {a["id"]: a for a in call_jxa({"op": "accountIds"})}
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        with open(CACHE, "w") as fh:
            json.dump({"at": time.time(), "accounts": accs, "nonAccounts": sorted(uuids - set(accs))}, fh, ensure_ascii=False)
        return accs

    # ----- resolution -----
    def resolve_accounts(self, spec):
        accs = list(self.accounts.values())
        if not spec:
            return [a for a in accs if a["enabled"]]
        out = []
        for w in [s.strip().lower() for s in spec.split(",") if s.strip()]:
            hit = (next((a for a in accs if a["name"].lower() == w), None)
                   or next((a for a in accs if a["user"].lower() == w or w in [e.lower() for e in a["emails"]]), None)
                   or next((a for a in accs if w in a["name"].lower() or any(w in e.lower() for e in a["emails"])), None))
            if not hit:
                raise ValueError(f"account not found: {w} (have: {', '.join(a['name'] for a in accs)})")
            if hit not in out:
                out.append(hit)
        return out

    def boxes_of(self, acc):
        return [b for b in self.boxes.values() if b["acct"] == acc["id"]]

    def resolve_mailbox(self, acc, spec, optional=False):
        boxes = self.boxes_of(acc)
        s = nfc(str(spec or "INBOX"))
        cands = ROLES.get(s.lower(), [s, s.split("/")[-1]])
        for c in cands:
            c = nfc(c).lower()
            for b in boxes:
                if b["name"].lower() == c or b["path"].lower() == c:
                    return b
        if optional:
            return None
        raise ValueError(f'mailbox "{s}" not found in account {acc["name"]} (have: {", ".join(b["name"] for b in boxes)})')

    def mailboxes_for(self, acc, spec):
        if spec in ("*", "all"):
            return self.boxes_of(acc)
        parts = str(spec or "INBOX").split(",")
        return [b for b in (self.resolve_mailbox(acc, p.strip(), len(parts) > 1) for p in parts) if b]

    # ----- queries -----
    _SELECT = """select m.ROWID, coalesce(m.subject_prefix, '') || coalesce(s.subject, ''), a.address, a.comment,
                        m.date_received, m.read, m.flagged, g.message_id_header
                 from {src}
                 left join subjects s on s.ROWID = m.subject
                 left join addresses a on a.ROWID = m.sender
                 left join message_global_data g on g.ROWID = m.global_message_id
                 where m.deleted = 0 and {where}"""

    def scan(self, acc, box, f):
        if box["source"] is None:
            src, where, args = "messages m", ["m.mailbox = ?"], [box["rid"]]
        else:  # Gmail label mailbox
            src, where, args = "labels l join messages m on m.ROWID = l.message_id", ["l.mailbox_id = ?"], [box["rid"]]
        like = lambda s: "%" + s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        sender_sql = "(a.address like ? escape '\\' or a.comment like ? escape '\\')"
        subject_sql = "(coalesce(m.subject_prefix, '') || coalesce(s.subject, '')) like ? escape '\\'"
        if f.get("from"):
            where.append(sender_sql); args += [like(f["from"])] * 2
        if f.get("subject"):
            where.append(subject_sql); args.append(like(f["subject"]))
        if f.get("query"):
            where.append(f"({sender_sql} or {subject_sql})"); args += [like(f["query"])] * 3
        if f.get("since"):
            where.append("m.date_received > ?"); args.append(int(datetime.fromisoformat(f["since"]).timestamp()))
        if f.get("before"):
            where.append("m.date_received < ?"); args.append(int(datetime.fromisoformat(f["before"]).timestamp()))
        if f.get("unread"):
            where.append("m.read = 0")
        if f.get("flagged"):
            where.append("m.flagged = 1")
        sql = self._SELECT.format(src=src, where=" and ".join(where))
        rows = []
        for rid, subj, addr, comment, dr, read, flagged, mid in self.con.execute(sql, args):
            frm = f"{comment} <{addr}>" if comment else (addr or "")
            rows.append({"ref": f"{acc['name']}:{box['name']}:{rid}", "account": acc["name"], "mailbox": box["name"], "id": rid,
                         "subject": subj, "from": frm,
                         "date": datetime.fromtimestamp(dr, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z") if dr else None,
                         "read": bool(read), "flagged": bool(flagged),
                         "messageId": (mid or "").strip().strip("<>") or None})
        return rows

    def gather(self, account, mailbox, f):
        rows = []
        for acc in self.resolve_accounts(account):
            for box in self.mailboxes_for(acc, mailbox):
                rows += self.scan(acc, box, f or {})
        return dedupe(rows)

    def count(self, acc, box):
        rows = self.scan(acc, box, {})
        return len(rows), sum(1 for r in rows if not r["read"])


def dedupe(rows):
    """Gmail shows one message under several label mailboxes with the same id; keep one row per
    account+id, preferring INBOX, then real folders, then Gmail's virtual ones."""
    def rank(r):
        n = r["mailbox"].lower()
        return 0 if r["mailbox"].upper() == "INBOX" else (2 + VIRTUAL.index(n) if n in VIRTUAL else 1)
    best = {}
    for r in rows:
        k = (r["account"], r["id"])
        cur = best.get(k)
        if cur is None:
            r["alsoIn"] = []
            best[k] = r
        elif rank(r) < rank(cur):
            r["alsoIn"] = cur["alsoIn"] + [cur["mailbox"]]
            best[k] = r
        else:
            cur["alsoIn"].append(r["mailbox"])
    return list(best.values())
