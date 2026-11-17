import AppKit
import Foundation
import Observation
import QuartzCore

/// Keystroke to glyph in the composer (PLAN.md §9), as the app measures it. Only the UI tests turn it on, with
/// `PICA_COMPOSER_METRICS_PATH`; `PICA_COMPOSER_TYPING_SCRIPT=<n>` also has the composer type `n` characters itself
/// once it has focus (`TypingScript`). Specified in docs/composer.md.
///
/// For each key that types a character, from the key event's timestamp:
/// - `commit`: until the run loop pass that drew the new glyph has committed its frame to the window server;
/// - `glyph`: until the first display refresh after that commit, the earliest the glyph can be on screen.
@Observable @MainActor
public final class ComposerMetrics {
    public struct Report: Codable, Equatable, Sendable {
        public var keystrokes = 0
        /// Characters in the input when the report was written.
        public var textLength = 0
        public var glyphMs: [Double] = []
        public var commitMs: [Double] = []
        /// From the event's timestamp to the composer handling it.
        public var queueMs: [Double] = []
        /// True once the typing script has typed every character.
        public var finished = false

        public init() {}
    }

    @ObservationIgnored let typingScriptLength: Int
    @ObservationIgnored private let reportURL: URL
    @ObservationIgnored private var report = Report()
    /// Keys handled whose glyph has not been drawn yet, by event timestamp.
    @ObservationIgnored private var received: [CFTimeInterval] = []
    @ObservationIgnored private var drawn: [CFTimeInterval] = []
    @ObservationIgnored private var committed: (keys: [CFTimeInterval], at: CFTimeInterval)?
    @ObservationIgnored private var lastFrameTarget: CFTimeInterval = 0
    @ObservationIgnored private var observer: CFRunLoopObserver?

    public init?(environment: [String: String]) {
        guard let path = environment["PICA_COMPOSER_METRICS_PATH"] else { return nil }
        reportURL = URL(filePath: path)
        typingScriptLength = environment["PICA_COMPOSER_TYPING_SCRIPT"].flatMap(Int.init) ?? 0
    }

    /// Core Animation commits a run loop pass's drawing in an observer of order 2,000,000; this one runs after it.
    static let afterCommitOrder: CFIndex = 2_100_000

    func start() {
        guard observer == nil else { return }
        let activities = CFRunLoopActivity.beforeWaiting.rawValue | CFRunLoopActivity.exit.rawValue
        let observer = CFRunLoopObserverCreateWithHandler(nil, activities, true, Self.afterCommitOrder) { _, _ in
            MainActor.assumeIsolated { self.passCommitted() }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
        self.observer = observer
    }

    func stop() {
        guard let observer else { return }
        CFRunLoopObserverInvalidate(observer)
        self.observer = nil
    }

    /// A key that types a character is about to be handled. `timestamp` is the event's, on `CACurrentMediaTime`'s clock.
    func keyReceived(timestamp: CFTimeInterval) {
        report.queueMs.append((CACurrentMediaTime() - timestamp) * 1000)
        received.append(timestamp)
    }

    /// The input has drawn its text.
    func inputDrew() {
        drawn += received
        received.removeAll()
    }

    private func passCommitted() {
        guard !drawn.isEmpty else { return }
        let now = CACurrentMediaTime()
        committed = (drawn + (committed?.keys ?? []), now)
        drawn.removeAll()
        if lastFrameTarget > now { present(at: lastFrameTarget) }
    }

    /// One display-link callback: `targetTimestamp` is when the frame being prepared will be shown.
    func frame(targetTimestamp: CFTimeInterval) {
        lastFrameTarget = targetTimestamp
        if let committed, targetTimestamp > committed.at { present(at: targetTimestamp) }
    }

    private func present(at shown: CFTimeInterval) {
        guard let committed else { return }
        self.committed = nil
        for key in committed.keys {
            report.glyphMs.append((shown - key) * 1000)
            report.commitMs.append((committed.at - key) * 1000)
        }
        report.keystrokes = report.glyphMs.count
    }

    func typingFinished(textLength: Int) {
        // Let the last keystroke reach the screen first.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.report.textLength = textLength
            self.report.finished = true
            self.write()
        }
    }

    private func write() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(report) else { return }
        try? data.write(to: reportURL, options: .atomic)
    }
}

/// Types a sentence into the composer at a steady pace, one key-down and key-up every `interval`, through the window's
/// event queue like any key. XCUITest's typing waits on accessibility snapshots that hold the main thread, which would
/// be counted against the composer.
@MainActor
final class TypingScript {
    static let settle: TimeInterval = 1.0
    static let interval: TimeInterval = 0.1
    static let sentence = "the quick brown fox jumps over the lazy dog "

    private let length: Int
    private weak var window: NSWindow?
    private var timer: Timer?
    private var typed = 0
    private let onFinish: () -> Void

    init(length: Int, window: NSWindow, onFinish: @escaping () -> Void) {
        self.length = length
        self.window = window
        self.onFinish = onFinish
    }

    func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.settle) { [weak self] in
            guard let self else { return }
            let timer = Timer(timeInterval: Self.interval, repeats: true) { _ in
                MainActor.assumeIsolated { self.typeNext() }
            }
            RunLoop.main.add(timer, forMode: .common)
            self.timer = timer
        }
    }

    private func typeNext() {
        guard typed < length, let window else {
            timer?.invalidate()
            timer = nil
            onFinish()
            return
        }
        let sentence = Array(Self.sentence)
        let character = String(sentence[typed % sentence.count])
        typed += 1
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(
                with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, characters: character,
                charactersIgnoringModifiers: character, isARepeat: false, keyCode: Self.keyCodes[character] ?? 0)
            else { continue }
            NSApp.postEvent(event, atStart: false)
        }
    }

    /// ANSI key codes for the sentence's characters.
    private static let keyCodes: [String: UInt16] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
        "e": 14, "r": 15, "y": 16, "t": 17, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45,
        "m": 46, " ": 49,
    ]
}
