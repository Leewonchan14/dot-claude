// kakao_ax: Accessibility helper for kakaoctl. Talks to the running KakaoTalk Mac app (native AppKit)
// through the AX API and prints JSON. Each AX round trip costs about 5 ms in KakaoTalk, so every
// command reads several attributes per call (AXUIElementCopyMultipleAttributeValues) and only the
// rows it needs.
//
//   kakao_ax windows                      {"main":bool,"chats":[titles of open chat windows],"front":bool,"hidden":bool}
//   kakao_ax show                         unhide KakaoTalk and reopen its main window if closed (brief activation)
//   kakao_ax hide                         hide KakaoTalk
//   kakao_ax chats [n]                    first n chat list rows of the main window (0 = all; ~30 ms per row)
//   kakao_ax tab <name>                   press a main-window tab button (채팅, 친구, ...)
//   kakao_ax messages <title> <n>         last n message rows of an open chat window
//   kakao_ax open <name> [index]          open a chat room (briefly activates KakaoTalk, then restores the previous app)
//   kakao_ax send <title> <text>          put text in the input of an open chat window and press 전송
//   kakao_ax close <title>                close an open chat window
import Cocoa
import ApplicationServices

let MAIN_TITLE = "카카오톡"
func out(_ obj: Any) {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [])
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
func fail(_ msg: String, _ code: Int32) -> Never { out(["error": msg]); exit(code) }

let args = Array(CommandLine.arguments.dropFirst())
let mode = args.first ?? "windows"
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.kakao.KakaoTalkMac").first else { fail("KakaoTalk is not running", 10) }
if let s = CGSessionCopyCurrentDictionary() as? [String: Any], (s["CGSSessionScreenIsLocked"] as? Bool) == true {
    fail("the screen is locked; macOS hides app windows from Accessibility until it is unlocked", 17)
}
let axApp = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(axApp, 2.0)

struct N { let el: AXUIElement; let role: String; let text: String?; let kids: [AXUIElement]; let frame: CGRect }
let KEYS = [kAXRoleAttribute, kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXChildrenAttribute,
            kAXPositionAttribute, kAXSizeAttribute] as CFArray
func node(_ el: AXUIElement) -> N {
    var vals: CFArray?
    AXUIElementCopyMultipleAttributeValues(el, KEYS, AXCopyMultipleAttributeOptions(rawValue: 0), &vals)
    let a = (vals as? [AnyObject]) ?? []
    guard a.count == 7 else { return N(el: el, role: "", text: nil, kids: [], frame: .zero) }
    let text = [a[1], a[2], a[3]].compactMap { $0 as? String }.first { !$0.isEmpty }
    var p = CGPoint.zero, s = CGSize.zero
    if CFGetTypeID(a[5]) == AXValueGetTypeID() { AXValueGetValue(a[5] as! AXValue, .cgPoint, &p) }
    if CFGetTypeID(a[6]) == AXValueGetTypeID() { AXValueGetValue(a[6] as! AXValue, .cgSize, &s) }
    return N(el: el, role: a[0] as? String ?? "", text: text, kids: a[4] as? [AXUIElement] ?? [], frame: CGRect(origin: p, size: s))
}
func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}
func windows() -> [N] { ((attr(axApp, kAXWindowsAttribute) as? [AXUIElement]) ?? []).map(node).filter { $0.role == "AXWindow" } }
func window(_ title: String) -> N? { windows().first { $0.text == title } }
func mainWindow() -> N {
    if app.isHidden { fail("KakaoTalk is hidden (Cmd+H); run 'kakaoctl show' to unhide it", 15) }
    return window(MAIN_TITLE) ?? { fail("KakaoTalk main window (카카오톡) is not open; run 'kakaoctl show' to reopen it", 11) }()
}
// the window's message/chat table: first AXScrollArea that holds an AXTable
func table(_ win: N) -> AXUIElement? {
    for k in win.kids {
        let n = node(k)
        if n.role == "AXScrollArea", let t = n.kids.first, node(t).role == "AXTable" { return t }
    }
    return nil
}
func rows(_ t: AXUIElement) -> [AXUIElement] { (attr(t, kAXRowsAttribute) as? [AXUIElement]) ?? [] }
// leaf items of a row in visual order: role, text, x/width relative to the window
func items(_ el: AXUIElement, _ win: N, _ acc: inout [[String: Any]]) {
    let n = node(el)
    switch n.role {
    case "AXStaticText", "AXTextArea", "AXImage", "AXButton":
        var d: [String: Any] = ["r": n.role.replacingOccurrences(of: "AX", with: ""), "t": n.text ?? ""]
        d["x"] = Double(n.frame.midX - win.frame.minX) / Double(max(win.frame.width, 1))
        acc.append(d)
        if n.role == "AXTextArea" { return }  // its AXLink children repeat the text
    default: break
    }
    for c in n.kids { items(c, win, &acc) }
}
func rowItems(_ r: AXUIElement, _ win: N) -> [[String: Any]] { var acc: [[String: Any]] = []; items(r, win, &acc); return acc }
func rowName(_ it: [[String: Any]]) -> String? { it.first { ($0["r"] as? String) == "StaticText" }?["t"] as? String }
func frontIsKakao() -> Bool { NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier }
func key(_ code: CGKeyCode) {
    for down in [true, false] { CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)!.postToPid(app.processIdentifier); usleep(15000) }
}

switch mode {
case "windows":
    let ws = windows()
    out(["main": ws.contains { $0.text == MAIN_TITLE }, "chats": ws.compactMap { $0.text }.filter { $0 != MAIN_TITLE }, "front": frontIsKakao(), "hidden": app.isHidden])

case "show":
    // unhide; if the main window is closed, reopen it (needs a brief activation) and give focus back
    if app.isHidden { _ = app.unhide(); usleep(300000) }
    if window(MAIN_TITLE) != nil { out(["ok": true, "flashed": false]); exit(0) }
    let prev = NSWorkspace.shared.frontmostApplication
    let cfg = NSWorkspace.OpenConfiguration()
    cfg.activates = true
    NSWorkspace.shared.openApplication(at: app.bundleURL!, configuration: cfg) { _, _ in }
    var opened = false
    for _ in 0..<40 {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
        if window(MAIN_TITLE) != nil { opened = true; break }
    }
    if let p = prev, p.processIdentifier != app.processIdentifier { usleep(150000); p.activate(options: []) }
    if !opened { fail("could not reopen the KakaoTalk main window", 16) }
    out(["ok": true, "flashed": prev?.processIdentifier != app.processIdentifier])

case "hide":
    _ = app.hide()  // asynchronous; its return value is unreliable
    for _ in 0..<20 { if app.isHidden { break }; RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05)) }  // isHidden refreshes on the run loop
    out(["ok": app.isHidden])

case "chats":
    let win = mainWindow()
    guard let t = table(win) else { fail("no chat list in the main window (is the 채팅 tab selected?)", 14) }
    let all = rows(t)
    let n = args.count > 1 ? (Int(args[1]) ?? 30) : 30
    out(["total": all.count, "rows": all.prefix(n <= 0 ? all.count : n).map { rowItems($0, win) }])

case "tab":
    let win = mainWindow()
    guard let b = win.kids.map(node).first(where: { $0.role == "AXButton" && $0.text == args[1] }) else { fail("tab not found: \(args[1])", 2) }
    out(["ok": AXUIElementPerformAction(b.el, kAXPressAction as CFString) == .success])

case "messages":
    guard args.count > 2, let win = window(args[1]) else { fail("chat window not open: \(args.count > 1 ? args[1] : "")", 12) }
    guard let t = table(win) else { fail("no message table in \(args[1])", 13) }
    let all = rows(t)
    let n = Int(args[2]) ?? 20
    let picked = all.suffix(n).map { r -> [[String: Any]] in var acc: [[String: Any]] = []; items(r, win, &acc); return acc }
    out(["title": args[1], "loaded": all.count, "rows": picked])

case "open":
    guard args.count > 1 else { fail("usage: open <name> [index]", 2) }
    let want = args[1]
    if window(want) != nil { out(["ok": true, "already": true]); exit(0) }
    let win = mainWindow()
    guard let t = table(win) else { fail("no chat list in the main window (is the 채팅 tab selected?)", 14) }
    let rs = rows(t)
    var hit: AXUIElement? = nil
    if args.count > 2, let i = Int(args[2]), i < rs.count, rowName(rowItems(rs[i], win)) == want { hit = rs[i] }
    if hit == nil { hit = rs.first { rowName(rowItems($0, win)) == want } }
    guard let row = hit else { fail("chat not found in the list: \(want)", 4) }
    let prev = NSWorkspace.shared.frontmostApplication
    let wasFront = frontIsKakao()
    if !wasFront { app.activate(options: []); usleep(250000) }
    // Return goes to KakaoTalk's key window. Another chat window may be in front, and Return there would
    // send whatever is in its input, so raise the main window and check it is focused before pressing it.
    _ = AXUIElementPerformAction(win.el, kAXRaiseAction as CFString)
    _ = AXUIElementSetAttributeValue(win.el, kAXMainAttribute as CFString, kCFBooleanTrue)
    var focusedMain = false
    for _ in 0..<15 {
        if let fw = attr(axApp, kAXFocusedWindowAttribute), node(fw as! AXUIElement).text == MAIN_TITLE { focusedMain = true; break }
        usleep(50000)
    }
    if !focusedMain {
        if !wasFront, let p = prev, p.processIdentifier != app.processIdentifier { p.activate(options: []) }
        fail("the KakaoTalk main window did not take focus; not pressing Return", 18)
    }
    _ = AXUIElementSetAttributeValue(row, kAXSelectedAttribute as CFString, kCFBooleanTrue)
    usleep(50000)
    key(36)  // Return opens the selected chat
    var opened = false
    for _ in 0..<30 { if window(want) != nil { opened = true; break }; usleep(100000) }
    if !wasFront, let p = prev, p.processIdentifier != app.processIdentifier { p.activate(options: []) }
    if !opened { fail("chat window did not open: \(want)", 5) }
    out(["ok": true, "flashed": !wasFront])

case "send":
    guard args.count > 2, let win = window(args[1]) else { fail("chat window not open: \(args.count > 1 ? args[1] : "")", 12) }
    let top = win.kids.map(node)
    guard let input = top.first(where: { $0.role == "AXScrollArea" && $0.kids.first.map { node($0).role == "AXTextArea" } == true })?.kids.first
    else { fail("message input not found", 6) }
    guard let btn = top.first(where: { $0.role == "AXButton" && $0.text == "전송" }) else { fail("send button not found", 7) }
    let before = table(win).map { rows($0).count } ?? 0
    guard AXUIElementSetAttributeValue(input, kAXValueAttribute as CFString, args[2] as CFString) == .success else { fail("could not set the input text", 8) }
    usleep(200000)
    _ = AXUIElementPerformAction(btn.el, kAXPressAction as CFString)  // returns an error code even when it sends
    var after = before
    for _ in 0..<30 {
        usleep(100000)
        after = table(win).map { rows($0).count } ?? 0
        if after > before { break }
    }
    let left = (attr(input, kAXValueAttribute) as? String) ?? ""
    out(["ok": after > before && left.isEmpty, "rowsBefore": before, "rowsAfter": after, "inputLeft": left])

case "close":
    guard args.count > 1, let win = window(args[1]) else { fail("chat window not open: \(args.count > 1 ? args[1] : "")", 12) }
    guard let cb = attr(win.el, kAXCloseButtonAttribute) else { fail("no close button", 9) }
    out(["ok": AXUIElementPerformAction(cb as! AXUIElement, kAXPressAction as CFString) == .success])

default:
    fail("unknown mode \(mode)", 3)
}
