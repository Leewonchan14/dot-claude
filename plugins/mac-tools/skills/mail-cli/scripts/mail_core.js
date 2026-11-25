// mailctl core: JXA bridge to Mail.app. Called as
//   osascript -l JavaScript mail_core.js '<json request>'
// Returns a JSON string {ok, data} or {ok:false, error}.

const ROLES = {
  inbox: ['INBOX', 'Inbox', '받은편지함'],
  archive: ['Archive', 'Archives', '보관함', '보관', 'Saved', 'Save', '[Gmail]/Archive', '전체보관함', 'All Mail', '[Gmail]/All Mail'],
  trash: ['휴지통', 'Trash', 'Deleted Messages', 'Deleted Items', '지운편지함'],
  junk: ['스팸함', 'Junk', 'Spam', 'Junk E-mail'],
  sent: ['보낸편지함', 'Sent Messages', 'Sent', 'Sent Items'],
  drafts: ['임시보관함', 'Drafts'],
};

let Mail;

function run(argv) {
  let req;
  try {
    req = JSON.parse(argv[0] || '{}');
    Mail = Application('Mail');
    const fn = OPS[req.op];
    if (!fn) throw new Error('unknown op: ' + req.op);
    return JSON.stringify({ ok: true, data: fn(req) });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
  }
}

// ---------- accounts / mailboxes ----------

function allAccounts() {
  const accs = Mail.accounts;
  const names = accs.name(), emails = accs.emailAddresses(), users = accs.userName(), enabled = accs.enabled();
  return names.map((n, i) => ({ name: n, emails: emails[i] || [], user: users[i] || '', enabled: enabled[i], spec: accs[i] }));
}

function resolveAccounts(spec) {
  const all = allAccounts();
  if (!spec) return all.filter(a => a.enabled);
  const wanted = String(spec).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const out = [];
  for (const w of wanted) {
    const hit = all.find(a => a.name.toLowerCase() === w)
      || all.find(a => a.user.toLowerCase() === w || a.emails.some(e => e.toLowerCase() === w))
      || all.find(a => a.name.toLowerCase().includes(w) || a.emails.some(e => e.toLowerCase().includes(w)));
    if (!hit) throw new Error('account not found: ' + w + ' (have: ' + all.map(a => a.name).join(', ') + ')');
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

function findAccount(name) {
  return resolveAccounts(name)[0];
}

// Returns {spec, name} or null. spec may be a role (inbox/archive/trash/junk/sent/drafts),
// an exact name, or a path like "[Gmail]/전체보관함".
function resolveMailbox(acc, spec, optional) {
  const names = acc.spec.mailboxes.name();
  const lower = names.map(n => n.toLowerCase());
  const s = String(spec || 'INBOX');
  const role = ROLES[s.toLowerCase()];
  const candidates = role ? role : [s, s.split('/').pop()];
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase());
    if (i >= 0) return { spec: acc.spec.mailboxes[i], name: names[i] };
  }
  if (optional) return null;
  throw new Error('mailbox "' + s + '" not found in account ' + acc.name + ' (have: ' + names.join(', ') + ')');
}

function mailboxesFor(acc, spec) {
  if (spec === '*' || spec === 'all') {
    const names = acc.spec.mailboxes.name();
    return names.map((n, i) => ({ spec: acc.spec.mailboxes[i], name: n }));
  }
  return String(spec || 'INBOX').split(',').map(s => resolveMailbox(acc, s.trim(), spec && spec.includes(','))).filter(Boolean);
}

// ---------- message helpers ----------

function iso(d) { try { return d ? d.toISOString() : null; } catch (e) { return null; } }

function lc(s) { return String(s || '').toLowerCase(); }

// Bulk-fetch every message of the mailbox unfiltered (fast: one Apple event per property)
// and filter in JS. Property reads on a "whose" collection re-run the filter each time (~10 s
// per property on a 5k mailbox), so whose is used only for body search, and only for ids.
function scan(acc, mb, f) {
  f = f || {};
  const coll = mb.spec.messages;
  const ids = coll.id();
  if (!ids.length) return [];
  const subj = coll.subject(), snd = coll.sender(), dr = coll.dateReceived(),
        rd = coll.readStatus(), fl = coll.flaggedStatus();
  let bodyIds = null;
  if (f.body) bodyIds = new Set(coll.whose({ content: { _contains: f.body } }).id());
  const since = f.since ? new Date(f.since) : null, before = f.before ? new Date(f.before) : null;
  const q = lc(f.query), from = lc(f.from), sub = lc(f.subject);
  const only = f.ids ? new Set(f.ids) : null;
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    if (from && !lc(snd[i]).includes(from)) continue;
    if (sub && !lc(subj[i]).includes(sub)) continue;
    if (q && !lc(subj[i]).includes(q) && !lc(snd[i]).includes(q)) continue;
    if (since && !(dr[i] > since)) continue;
    if (before && !(dr[i] < before)) continue;
    if (f.unread && rd[i]) continue;
    if (f.flagged && !fl[i]) continue;
    if (bodyIds && !bodyIds.has(ids[i])) continue;
    if (only && !only.has(acc.name + ':' + ids[i])) continue;
    out.push({ ref: acc.name + ':' + mb.name + ':' + ids[i], account: acc.name, mailbox: mb.name, id: ids[i],
      subject: subj[i], from: snd[i], date: iso(dr[i]), read: rd[i], flagged: fl[i], _mb: mb });
  }
  return out;
}

// Gmail exposes one message under several label mailboxes with the same id.
// Keep one row per account+id, preferring a real folder over Gmail's virtual ones.
const VIRTUAL = ['전체보관함', 'all mail', '중요', 'important', '별표편지함', 'starred'];
function dedupe(rows) {
  const best = {};
  const rank = r => (r.mailbox.toUpperCase() === 'INBOX' ? 0 : VIRTUAL.indexOf(lc(r.mailbox)) >= 0 ? 2 + VIRTUAL.indexOf(lc(r.mailbox)) : 1);
  for (const r of rows) {
    const k = r.account + ':' + r.id;
    if (!best[k] || rank(r) < rank(best[k])) { if (best[k]) r.alsoIn = (best[k].alsoIn || []).concat(best[k].mailbox); else r.alsoIn = []; best[k] = r; }
    else best[k].alsoIn = (best[k].alsoIn || []).concat(r.mailbox);
  }
  return Object.keys(best).map(k => best[k]);
}

let SKIPPED = [];
function gather(req) {
  let rows = [];
  for (const a of resolveAccounts(req.account)) for (const mb of mailboxesFor(a, req.mailbox)) {
    try { rows = rows.concat(scan(a, mb, req.filter)); }
    catch (e) { SKIPPED.push(a.name + ':' + mb.name + ' (' + String((e && e.message) || e) + ')'); }
  }
  return dedupe(rows);
}

function snippetOf(msg, n) {
  try { return String(msg.content() || '').replace(/[￼\s]+/g, ' ').trim().slice(0, n || 200); }
  catch (e) { return null; }
}

function finish(rows, req) {
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const limit = req.limit == null ? 20 : req.limit;
  const total = rows.length;
  if (limit > 0) rows = rows.slice(0, limit);
  if (req.lite) { for (const r of rows) delete r._mb; return { total: total, shown: rows.length, messages: rows, skipped: SKIPPED }; }
  for (const r of rows) {
    const msg = r._mb.spec.messages.byId(r.id);
    try { r.messageId = msg.messageId(); } catch (e) { r.messageId = null; }
    if (req.snippet) r.snippet = snippetOf(msg, req.snippet);
    if (r.alsoIn && !r.alsoIn.length) delete r.alsoIn;
  }
  for (const r of rows) delete r._mb;
  return { total: total, shown: rows.length, messages: rows, skipped: SKIPPED };
}

function normMid(s) { return String(s).trim().replace(/^</, '').replace(/>$/, ''); }

// ref = "Account:Mailbox:id" or a Message-Id ("<...@...>" / "...@...")
function resolveRef(ref) {
  const r = String(ref).trim();
  const m = r.match(/^([^:]+):(.+):(\d+)$/);
  if (m) {
    const acc = findAccount(m[1]);
    const mb = resolveMailbox(acc, m[2]);
    const msg = mb.spec.messages.byId(Number(m[3]));
    try { msg.subject(); } catch (e) { throw new Error('message not found: ' + r + ' (moved? ids change after a move; look it up again by Message-Id)'); }
    return { acc: acc, mb: mb, msg: msg, id: Number(m[3]) };
  }
  if (r.includes('@')) {
    const mid = normMid(r);
    const accs = resolveAccounts(null);
    const order = mb => (mb.name.toUpperCase() === 'INBOX' ? 0 : VIRTUAL.indexOf(lc(mb.name)) >= 0 ? 2 : 1);
    const boxes = [];
    for (const acc of accs) for (const mb of mailboxesFor(acc, '*')) boxes.push({ acc: acc, mb: mb });
    boxes.sort((a, b) => order(a.mb) - order(b.mb));
    for (const { acc, mb } of boxes) {
      {
        const ids = mb.spec.messages.whose({ messageId: mid }).id();
        if (ids.length) return { acc: acc, mb: mb, msg: mb.spec.messages.byId(ids[0]), id: ids[0] };
      }
    }
    throw new Error('no message with Message-Id ' + mid);
  }
  throw new Error('bad ref: ' + r + ' (expected Account:Mailbox:id or a Message-Id)');
}

function describe(x) {
  return { ref: x.acc.name + ':' + x.mb.name + ':' + x.id, subject: x.msg.subject(), from: x.msg.sender(), date: iso(x.msg.dateReceived()), messageId: x.msg.messageId() };
}

// Find a message in a mailbox by Message-Id without a slow whose-scan:
// try the old id first (Gmail keeps it), then compare Message-Id only on messages with the same date.
function findInMailbox(mb, mid, oldId, date) {
  if (oldId != null) { try { const m = mb.spec.messages.byId(oldId); if (normMid(m.messageId()) === mid) return oldId; } catch (e) {} }
  const ids = mb.spec.messages.id();
  const dates = date ? mb.spec.messages.dateReceived() : null;
  const t = date ? new Date(date).getTime() : null;
  let hit = null;
  for (let i = 0; i < ids.length; i++) {
    if (t != null && Math.abs(dates[i].getTime() - t) > 1000) continue;
    try { if (normMid(mb.spec.messages.byId(ids[i]).messageId()) === mid) hit = Math.max(hit || 0, ids[i]); } catch (e) {}
  }
  return hit;
}

function locateAfterMove(dest, acc, mid, oldId, date) {
  for (let i = 0; i < 24; i++) {
    const id = findInMailbox(dest, normMid(mid), oldId, date);
    if (id != null) return acc.name + ':' + dest.name + ':' + id;
    delay(0.25);
  }
  return null;
}

function moveRefs(req, destFor) {
  const results = [];
  for (const ref of req.refs || []) {
    try {
      const x = resolveRef(ref);
      const d = describe(x);
      const target = destFor(x);
      d.to = target.acc.name + ':' + target.mb.name;
      if (target.acc.name === x.acc.name && target.mb.name === x.mb.name) { d.status = 'skipped (already there)'; results.push(d); continue; }
      if (req.dryRun) { d.status = 'dry-run'; results.push(d); continue; }
      Mail.move(x.msg, { to: target.mb.spec });
      d.newRef = locateAfterMove(target.mb, target.acc, d.messageId, x.id, d.date);
      d.status = d.newRef ? 'moved' : 'moved (new id not found yet; look up by Message-Id)';
      results.push(d);
    } catch (e) {
      results.push({ ref: ref, status: 'error', error: String((e && e.message) || e) });
    }
  }
  return results;
}

// ---------- ops ----------

const OPS = {
  accountIds() {
    return allAccounts().map(a => ({ id: a.spec.id(), name: a.name, emails: a.emails, user: a.user, enabled: a.enabled }));
  },

  accounts() {
    return allAccounts().map(a => {
      const inbox = resolveMailbox(a, 'inbox', true);
      return { name: a.name, emails: a.emails, user: a.user, enabled: a.enabled,
        inbox: inbox ? { total: inbox.spec.messages.length, unread: inbox.spec.unreadCount() } : null };
    });
  },

  mailboxes(req) {
    return resolveAccounts(req.account).map(a => {
      const boxes = a.spec.mailboxes();
      return { account: a.name, mailboxes: boxes.map(b => {
        const o = { name: b.name(), unread: b.unreadCount() };
        try { o.path = b.container().name() + '/' + o.name; } catch (e) { o.path = o.name; }
        if (req.counts) o.total = b.messages.length;
        for (const k in ROLES) if (ROLES[k].some(c => c.toLowerCase() === o.name.toLowerCase())) o.role = k;
        return o;
      }) };
    });
  },

  count(req) {
    const rows = [];
    for (const a of resolveAccounts(req.account)) for (const mb of mailboxesFor(a, req.mailbox)) {
      rows.push({ account: a.name, mailbox: mb.name, total: mb.spec.messages.length, unread: mb.spec.unreadCount() });
    }
    return rows;
  },

  list(req) {
    return finish(gather(req), req);
  },

  read(req) {
    const x = resolveRef(req.ref);
    const m = x.msg;
    const out = describe(x);
    out.account = x.acc.name; out.mailbox = x.mb.name;
    out.to = m.toRecipients.address();
    out.cc = m.ccRecipients.address();
    out.replyTo = m.replyTo();
    out.read = m.readStatus(); out.flagged = m.flaggedStatus();
    out.attachments = (function () { try { return m.mailAttachments.name(); } catch (e) { return []; } })();
    const max = req.maxChars || 4000;
    const body = String(m.content() || '').replace(/￼/g, '');
    out.content = body.slice(0, max);
    out.truncated = body.length > max;
    if (req.headers) out.headers = m.allHeaders();
    if (req.source) { const s = String(m.source() || ''); out.source = s.slice(0, req.maxBytes || 65536); out.sourceTruncated = s.length > (req.maxBytes || 65536); }
    return out;
  },

  move(req) {
    return moveRefs(req, x => {
      const spec = String(req.to);
      const cross = spec.match(/^([^:]+):(.+)$/);
      const acc = cross ? findAccount(cross[1]) : x.acc;
      return { acc: acc, mb: resolveMailbox(acc, cross ? cross[2] : spec) };
    });
  },
  archive(req) { return moveRefs(req, x => ({ acc: x.acc, mb: resolveMailbox(x.acc, 'archive') })); },
  trash(req) { return moveRefs(req, x => ({ acc: x.acc, mb: resolveMailbox(x.acc, 'trash') })); },
  inbox(req) { return moveRefs(req, x => ({ acc: x.acc, mb: resolveMailbox(x.acc, 'inbox') })); },

  mark(req) {
    return (req.refs || []).map(ref => {
      try {
        const x = resolveRef(ref); const d = describe(x);
        d.action = req.action;
        if (!req.dryRun) {
          if (req.action === 'read') x.msg.readStatus = true;
          else if (req.action === 'unread') x.msg.readStatus = false;
          else if (req.action === 'flag') x.msg.flaggedStatus = true;
          else if (req.action === 'unflag') x.msg.flaggedStatus = false;
          else throw new Error('unknown mark action ' + req.action);
        }
        d.status = req.dryRun ? 'dry-run' : 'done';
        return d;
      } catch (e) { return { ref: ref, status: 'error', error: String((e && e.message) || e) }; }
    });
  },

  // Fallback body check for messages whose .emlx is not on disk: Mail renders content() itself.
  bodyMatch(req) {
    const needle = String(req.text).toLowerCase().split(/\s+/).join(' ');
    const out = [];
    for (const ref of req.refs || []) {
      try {
        const x = resolveRef(ref);
        const body = String(x.msg.content() || '').toLowerCase().split(/\s+/).join(' ');
        if (body.includes(needle)) out.push(x.acc.name + ':' + x.id);
      } catch (e) {}
    }
    return out;
  },

  senders(req) {
    let rows = gather(req);
    const groups = {};
    for (const r of rows) {
      const addr = ((r.from.match(/<([^>]+)>/) || [])[1] || r.from).toLowerCase();
      const g = groups[addr] || (groups[addr] = { address: addr, name: r.from.replace(/\s*<[^>]+>\s*$/, '').replace(/^"|"$/g, ''), count: 0, unread: 0, accounts: [], latest: null, latestSubject: '', refs: [] });
      g.count++; if (!r.read) g.unread++;
      if (!g.accounts.includes(r.account)) g.accounts.push(r.account);
      if (!g.latest || r.date > g.latest) { g.latest = r.date; g.latestSubject = r.subject; }
      g.refs.push(r.ref);
    }
    const list = Object.keys(groups).map(k => groups[k]).sort((a, b) => b.count - a.count || (b.latest || '').localeCompare(a.latest || ''));
    const limit = req.limit == null ? 20 : req.limit;
    return { total: list.length, senders: limit > 0 ? list.slice(0, limit) : list };
  },

  unsubscribe(req) {
    let rows = gather(req);
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    rows = rows.slice(0, req.scan || 50);
    const groups = {};
    for (const r of rows) {
      let h = '';
      try { h = r._mb.spec.messages.byId(r.id).allHeaders(); } catch (e) { continue; }
      const unfolded = h.replace(/\r?\n[ \t]+/g, ' ');
      const lu = (unfolded.match(/^list-unsubscribe:\s*(.+)$/im) || [])[1];
      if (!lu) continue;
      const post = /^list-unsubscribe-post:/im.test(unfolded);
      const links = (lu.match(/<[^>]+>/g) || []).map(s => s.slice(1, -1));
      const addr = ((r.from.match(/<([^>]+)>/) || [])[1] || r.from).toLowerCase();
      const g = groups[addr] || (groups[addr] = { address: addr, name: r.from.replace(/\s*<[^>]+>\s*$/, '').replace(/^"|"$/g, ''), count: 0, accounts: [], latestSubject: r.subject, latest: r.date, oneClick: post, http: null, mailto: null, refs: [] });
      g.count++;
      if (!g.accounts.includes(r.account)) g.accounts.push(r.account);
      g.http = g.http || links.find(l => /^https?:/i.test(l)) || null;
      g.mailto = g.mailto || links.find(l => /^mailto:/i.test(l)) || null;
      g.refs.push(r.ref);
    }
    for (const r of rows) delete r._mb;
    const list = Object.keys(groups).map(k => groups[k]).sort((a, b) => b.count - a.count);
    return { scanned: rows.length, senders: list };
  },
};
