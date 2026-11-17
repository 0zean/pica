import AppKit
import DesignSystem
import PicaProtocol
import QuartzCore
import SwiftUI

/// The composer's multiline text input: an `NSTextView`, for the key handling completions need (Return, Tab, arrows
/// and Escape go to the list while it shows), mention highlighting, and a height that follows the text.
///
/// Keys: ⌘↩ sends (or queues while a turn runs), ⇧⌘↩ steers, ⌘. stops the turn; Return is a new line unless the
/// completion list is showing, when it inserts the selected item, as Tab does.
struct ComposerInput: NSViewRepresentable {
    let store: ComposerStore
    let metrics: ComposerMetrics?
    /// The store's `catalogRevision`: when it changes, mentions are colored again.
    let catalogRevision: Int
    @Binding var height: CGFloat

    static let minLines = 1
    static let maxLines = 8
    static let font = NSFont.systemFont(ofSize: 13)
    static let inset = NSSize(width: 0, height: 6)

    static var lineHeight: CGFloat {
        NSLayoutManager().defaultLineHeight(for: font)
    }

    static func height(forContent content: CGFloat) -> CGFloat {
        let lines = min(max(content, lineHeight * CGFloat(minLines)), lineHeight * CGFloat(maxLines))
        return ceil(lines + inset.height * 2)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(store: store, height: $height)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let textView = ComposerTextView(usingTextLayoutManager: false)
        textView.metrics = metrics
        textView.font = Self.font
        textView.textColor = NSColor(Palette.textPrimary)
        textView.insertionPointColor = NSColor(Palette.accent)
        textView.drawsBackground = false
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.textContainerInset = Self.inset
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.typingAttributes = [.font: Self.font, .foregroundColor: NSColor(Palette.textPrimary)]
        textView.setAccessibilityIdentifier("pica.composer.input")
        textView.setAccessibilityLabel("Message")
        textView.string = store.text
        textView.delegate = context.coordinator
        textView.onKey = { [weak coordinator = context.coordinator] event in coordinator?.handle(event) ?? false }

        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        scrollView.documentView = textView
        context.coordinator.attach(textView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.catalogsChanged(catalogRevision)
    }

    static func dismantleNSView(_ scrollView: NSScrollView, coordinator: Coordinator) {
        (scrollView.documentView as? ComposerTextView)?.detach()
        coordinator.store.editSink = nil
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        let store: ComposerStore
        private let height: Binding<CGFloat>
        private weak var textView: ComposerTextView?
        private var highlighted: [Range<Int>] = []

        init(store: ComposerStore, height: Binding<CGFloat>) {
            self.store = store
            self.height = height
        }

        func attach(_ textView: ComposerTextView) {
            self.textView = textView
            store.editSink = { [weak self] edit in self?.apply(edit) }
            highlight()
            DispatchQueue.main.async { self.measure() }
        }

        /// Applies an edit through the text view, so it can be undone, and gives it focus.
        private func apply(_ edit: ComposerEdit) {
            guard let textView else { return }
            let range = NSRange(location: edit.range.lowerBound, length: edit.range.count)
            if textView.shouldChangeText(in: range, replacementString: edit.replacement) {
                textView.textStorage?.replaceCharacters(in: range, with: edit.replacement)
                textView.didChangeText()
            }
            textView.setSelectedRange(NSRange(location: edit.caret, length: 0))
            store.caretDidMove(edit.caret)
            textView.window?.makeFirstResponder(textView)
        }

        func textDidChange(_ notification: Notification) {
            guard let textView else { return }
            store.textDidChange(textView.string, caret: textView.selectedRange().location)
            highlight()
            measure()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView else { return }
            store.caretDidMove(textView.selectedRange().location)
        }

        /// Handles a key before the text view does; true when it was used.
        func handle(_ event: NSEvent) -> Bool {
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let command = flags.contains(.command)
            let showing = store.completion != nil
            switch event.keyCode {
            case KeyCode.return, KeyCode.enter:
                if command {
                    let mode: SendMode? = flags.contains(.shift) ? .steer : nil
                    Task { await store.submit(mode) }
                    return true
                }
                if showing, flags.isDisjoint(with: [.shift, .option, .control]) { return store.acceptCompletion() }
                return false
            case KeyCode.tab where showing && flags.isEmpty:
                return store.acceptCompletion()
            case KeyCode.upArrow where showing && flags.isDisjoint(with: [.command, .shift, .option]):
                store.moveSelection(by: -1)
                return true
            case KeyCode.downArrow where showing && flags.isDisjoint(with: [.command, .shift, .option]):
                store.moveSelection(by: 1)
                return true
            case KeyCode.escape where showing:
                store.dismissCompletion()
                return true
            case KeyCode.period where command && store.isRunning:
                Task { await store.stop() }
                return true
            default:
                return false
            }
        }

        /// Colors mentions and skills that name something known; others stay plain text.
        private func highlight() {
            guard let textView, let layoutManager = textView.layoutManager else { return }
            let resolver = MentionResolver(repos: store.repos, agents: store.agents.map(\.name))
            let skills = Set(store.skills)
            let ranges = MentionTokenizer.tokens(in: textView.string).compactMap { token -> Range<Int>? in
                switch token.kind {
                case .mention: resolver.resolve(token.name) == .unknown ? nil : token.range
                case .skill: skills.contains(token.name) ? token.range : nil
                }
            }
            guard ranges != highlighted else { return }
            let length = (textView.string as NSString).length
            layoutManager.removeTemporaryAttribute(.foregroundColor, forCharacterRange: NSRange(location: 0, length: length))
            for range in ranges {
                layoutManager.addTemporaryAttribute(
                    .foregroundColor, value: NSColor(Palette.accent),
                    forCharacterRange: NSRange(location: range.lowerBound, length: range.count))
            }
            highlighted = ranges
        }

        private func measure() {
            guard let textView, let layoutManager = textView.layoutManager, let container = textView.textContainer else { return }
            layoutManager.ensureLayout(for: container)
            let content = layoutManager.usedRect(for: container).height
            let new = ComposerInput.height(forContent: content)
            if abs(new - height.wrappedValue) > 0.5 { height.wrappedValue = new }
        }

        private var catalogRevision = 0

        /// Called when the catalogs arrive, so mentions typed before then are colored.
        func catalogsChanged(_ revision: Int) {
            guard revision != catalogRevision else { return }
            catalogRevision = revision
            highlighted = []
            highlight()
        }
    }
}

enum KeyCode {
    static let `return`: UInt16 = 36
    static let enter: UInt16 = 76
    static let tab: UInt16 = 48
    static let escape: UInt16 = 53
    static let upArrow: UInt16 = 126
    static let downArrow: UInt16 = 125
    static let period: UInt16 = 47
}

/// The text view: hands keys to the coordinator first, draws the placeholder, and reports to `ComposerMetrics`.
final class ComposerTextView: NSTextView {
    var onKey: ((NSEvent) -> Bool)?
    var metrics: ComposerMetrics?
    static let placeholder = "Message the session. @ mentions a repo, file or agent; / runs a skill; ⌘↩ sends."

    private var link: CADisplayLink?

    override func keyDown(with event: NSEvent) {
        if onKey?(event) == true { return }
        guard let metrics, Self.typesCharacter(event) else {
            super.keyDown(with: event)
            return
        }
        metrics.keyReceived(timestamp: event.timestamp)
        let start = CACurrentMediaTime()
        super.keyDown(with: event)
        metrics.keyHandled(seconds: CACurrentMediaTime() - start)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if window?.firstResponder === self, onKey?(event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }

    override func didChangeText() {
        super.didChangeText()
        metrics?.textChanged(length: (string as NSString).length)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if string.isEmpty {
            let attributes: [NSAttributedString.Key: Any] = [
                .font: ComposerInput.font, .foregroundColor: NSColor(Palette.textSecondary),
            ]
            let origin = NSPoint(x: textContainerInset.width, y: textContainerInset.height)
            (Self.placeholder as NSString).draw(at: origin, withAttributes: attributes)
        }
        metrics?.inputDrew()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        link?.invalidate()
        link = nil
        guard window != nil, let metrics else { return }
        metrics.start()
        let link = displayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func detach() {
        link?.invalidate()
        link = nil
        metrics?.stop()
    }

    @objc private func tick(_ link: CADisplayLink) {
        metrics?.frame(targetTimestamp: link.targetTimestamp)
    }

    private static func typesCharacter(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .control])
        guard flags.isEmpty, let characters = event.characters, let scalar = characters.unicodeScalars.first else {
            return false
        }
        return !CharacterSet.controlCharacters.contains(scalar) && scalar.value < 0xF700
    }
}

extension NSColor {
    /// A token as an AppKit color that follows the view's appearance, for the text view.
    convenience init(_ token: PicaColor) {
        self.init(name: nil) { appearance in
            let dark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let increased = appearance.name.rawValue.contains("HighContrast")
            let rgb = token.rgb(for: dark ? (increased ? .darkIncreasedContrast : .dark) : (increased ? .lightIncreasedContrast : .light))
            return NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
        }
    }
}
