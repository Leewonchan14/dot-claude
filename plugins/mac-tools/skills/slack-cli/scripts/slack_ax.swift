// slack_ax: Accessibility helper for slackctl. Talks to the running Slack desktop app without
// activating it: reads the AX tree (Electron web content via AXManualAccessibility), performs AX
// actions on elements, sets values, and posts key events straight to Slack's pid.
//
//   slack_ax windows
//   slack_ax dump                       JSON array of nodes {i, depth, role, text, cls, id, acts, val}
//   slack_ax press|menu|show|focus|cancel <target>
//   slack_ax set <target> <text>
//   slack_ax type <text>                unicode key events to Slack's pid (goes to Slack's focused element)
//   slack_ax key <keycode>              e.g. 36 = Return
// target: "#<dom id>" | "i:<index from dump>" | "=<exact text>"
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}
func str(_ el: AXUIElement, _ name: String) -> String? {
    if let s = attr(el, name) as? String, !s.isEmpty { return s }
    return nil
}
func children(_ el: AXUIElement) -> [AXUIElement] { (attr(el, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func out(_ s: String) { FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!) }
func fail(_ msg: String, _ code: Int32) -> Never { out("{\"error\":\"\(msg)\"}"); exit(code) }

let args = Array(CommandLine.arguments.dropFirst())
let mode = args.first ?? "dump"
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.tinyspeck.slackmacgap").first else { fail("Slack is not running", 10) }

if mode == "type" || mode == "key" {
    if mode == "type" {
        let text = args.count > 1 ? args[1] : ""
        for ch in text.utf16 {
            var c = ch
            for down in [true, false] {
                let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)!
                e.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
                e.postToPid(app.processIdentifier)
                usleep(15000)
            }
        }
        out("{\"ok\":true}")
    } else {
        let code = CGKeyCode(Int(args.count > 1 ? args[1] : "36") ?? 36)
        for down in [true, false] { CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)!.postToPid(app.processIdentifier); usleep(15000) }
        out("{\"ok\":true}")
    }
    exit(0)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
let wins = (attr(axApp, kAXWindowsAttribute) as? [AXUIElement]) ?? []
if mode == "windows" {
    let titles = wins.map { (str($0, kAXTitleAttribute) ?? "").replacingOccurrences(of: "\"", with: "'") }
    out("{\"windows\":\(wins.count),\"titles\":[\(titles.map { "\"\($0)\"" }.joined(separator: ","))]}")
    exit(0)
}
guard let win = wins.first(where: { (str($0, kAXTitleAttribute) ?? "").hasSuffix("Slack") }) ?? wins.first else { fail("no Slack window is open", 11) }

struct Node: Encodable { let i: Int; let depth: Int; let role: String; let text: String?; let cls: String?; let id: String?; let acts: [String]?; let val: Int? }
var els: [AXUIElement] = []
var nodes: [Node] = []
func walk(_ el: AXUIElement, _ depth: Int) {
    if els.count >= 40000 || depth > 80 { return }
    let role = str(el, kAXRoleAttribute) ?? ""
    let text = str(el, kAXValueAttribute) ?? str(el, kAXTitleAttribute) ?? str(el, kAXDescriptionAttribute)
    let val = (attr(el, kAXValueAttribute) as? NSNumber)?.intValue
    let cls = (attr(el, "AXDOMClassList") as? [String])?.joined(separator: " ")
    let id = str(el, "AXDOMIdentifier")
    var names: CFArray?
    AXUIElementCopyActionNames(el, &names)
    let acts = ((names as? [String]) ?? []).filter { $0 != "AXShowMenu" && $0 != "AXScrollToVisible" }
    nodes.append(Node(i: els.count, depth: depth, role: role, text: text, cls: cls, id: id, acts: acts.isEmpty ? nil : acts, val: val))
    els.append(el)
    for c in children(el) { walk(c, depth + 1) }
}
walk(win, 0)

if mode == "dump" { FileHandle.standardOutput.write(try! JSONEncoder().encode(nodes)); exit(0) }

let t = args.count > 1 ? args[1] : ""
var idx: Int? = nil
if t.hasPrefix("#") { idx = nodes.firstIndex { $0.id == String(t.dropFirst()) } }
else if t.hasPrefix("i:") { idx = Int(t.dropFirst(2)) }
else if t.hasPrefix("=") { idx = nodes.firstIndex { $0.text == String(t.dropFirst()) } }
guard let k = idx, k < els.count else { fail("target not found: \(t)", 2) }
let el = els[k]
var ok = false
switch mode {
case "press": ok = AXUIElementPerformAction(el, kAXPressAction as CFString) == .success
case "menu": ok = AXUIElementPerformAction(el, "AXShowMenu" as CFString) == .success
case "show": ok = AXUIElementPerformAction(el, "AXScrollToVisible" as CFString) == .success
case "cancel": ok = AXUIElementPerformAction(el, kAXCancelAction as CFString) == .success
case "focus": ok = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
case "set": ok = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, (args.count > 2 ? args[2] : "") as CFString) == .success
default: fail("unknown mode \(mode)", 3)
}
out("{\"ok\":\(ok),\"index\":\(k)}")
