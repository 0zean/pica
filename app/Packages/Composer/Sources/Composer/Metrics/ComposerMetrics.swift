import AppKit
import Foundation
import Observation
import QuartzCore

/// Keystroke to glyph in the composer (PLAN.md §9), as the app measures it. Only the UI tests turn it on, with
/// `PICA_COMPOSER_METRICS_PATH`; the report is written once keys stop arriving. Specified in docs/composer.md.
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
        /// How long the composer took to handle each key (`keyDown`).
        public var handleMs: [Double] = []

        public init() {}
    }

    @ObservationIgnored private let reportURL: URL
    @ObservationIgnored private var report = Report()
    /// Keys handled whose glyph has not been drawn yet, by event timestamp.
    @ObservationIgnored private var received: [CFTimeInterval] = []
    @ObservationIgnored private var drawn: [CFTimeInterval] = []
    @ObservationIgnored private var committed: (keys: [CFTimeInterval], at: CFTimeInterval)?
    @ObservationIgnored private var lastFrameTarget: CFTimeInterval = 0
    @ObservationIgnored private var observer: CFRunLoopObserver?
    @ObservationIgnored private var pendingWrite: DispatchWorkItem?

    public init?(environment: [String: String]) {
        guard let path = environment["PICA_COMPOSER_METRICS_PATH"] else { return nil }
        reportURL = URL(filePath: path)
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
    func keyHandled(seconds: CFTimeInterval) {
        report.handleMs.append(seconds * 1000)
    }

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
        scheduleWrite()
    }

    /// The input's length after each change, for the report.
    func textChanged(length: Int) {
        report.textLength = length
    }

    /// Writes the report once keys stop arriving for half a second, so a test that types through XCUITest can read it.
    private func scheduleWrite() {
        pendingWrite?.cancel()
        let write = DispatchWorkItem { [weak self] in self?.write() }
        pendingWrite = write
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: write)
    }

    private func write() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(report) else { return }
        try? data.write(to: reportURL, options: .atomic)
    }
}
