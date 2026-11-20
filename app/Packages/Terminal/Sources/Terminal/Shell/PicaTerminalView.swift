import AppKit
import SwiftTerm

/// SwiftTerm's terminal view, with the visible screen as its accessibility value so VoiceOver and UI tests can read
/// it. A line the terminal wrapped is joined to the one before it.
final class PicaTerminalView: LocalProcessTerminalView {
    override func isAccessibilityElement() -> Bool { true }

    override func accessibilityRole() -> NSAccessibility.Role? { .textArea }

    override func accessibilityLabel() -> String? { "Terminal" }

    override func accessibilityValue() -> Any? { screenText }

    var screenText: String {
        guard let terminal else { return "" }
        var lines: [String] = []
        for row in 0..<terminal.rows {
            guard let line = terminal.getLine(row: row) else { continue }
            let text = line.translateToString(trimRight: true)
            if line.isWrapped, let previous = lines.popLast() {
                lines.append(previous + text)
            } else {
                lines.append(text)
            }
        }
        while lines.last?.isEmpty == true {
            lines.removeLast()
        }
        return lines.joined(separator: "\n")
    }
}
