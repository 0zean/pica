import Foundation
import Observation
import QuartzCore

/// The timeline's performance as the app measures it (PLAN.md §9): how long a session took to open, and the hitch time
/// ratio while it scrolled. Only the UI tests turn it on, with `PICA_TIMELINE_METRICS_PATH`; it writes a JSON report
/// there after a session opens and after each stretch of scrolling. Specified in docs/session-timeline.md.
@Observable @MainActor
public final class TimelineMetrics {
    public struct Report: Codable, Equatable, Sendable {
        public var sessionId = ""
        public var openSeconds: Double?
        /// From opening to the first event, and to the last event of the history being applied.
        public var firstEventSeconds: Double?
        public var catchUpSeconds: Double?
        public var events = 0
        /// The last `seq` applied, updated as events arrive after the session opened.
        public var lastSeq = 0
        public var rows = 0
        public var scrollSeconds: Double = 0
        public var hitchSeconds: Double = 0
        public var hitches = 0
        /// Where the list is scrolled to, as of the last time it stopped moving.
        public var scrollOffset: Double = 0
        public var contentHeight: Double = 0
        public var viewportHeight: Double = 0
        /// True once the scroll script has run.
        public var scrolled = false
        /// Hitch time over scroll time, as XCTest's hitch metrics define it (they report it in ms per s).
        public var hitchRatio: Double { scrollSeconds > 0 ? hitchSeconds / scrollSeconds : 0 }

        private enum CodingKeys: String, CodingKey {
            case sessionId, openSeconds, firstEventSeconds, catchUpSeconds, events, lastSeq, rows, scrollSeconds, hitchSeconds, hitches,
                scrollOffset, contentHeight, viewportHeight, scrolled, hitchRatio
        }

        public init() {}

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            sessionId = try container.decode(String.self, forKey: .sessionId)
            openSeconds = try container.decodeIfPresent(Double.self, forKey: .openSeconds)
            firstEventSeconds = try container.decodeIfPresent(Double.self, forKey: .firstEventSeconds)
            catchUpSeconds = try container.decodeIfPresent(Double.self, forKey: .catchUpSeconds)
            events = try container.decode(Int.self, forKey: .events)
            lastSeq = try container.decode(Int.self, forKey: .lastSeq)
            rows = try container.decode(Int.self, forKey: .rows)
            scrollSeconds = try container.decode(Double.self, forKey: .scrollSeconds)
            hitchSeconds = try container.decode(Double.self, forKey: .hitchSeconds)
            hitches = try container.decode(Int.self, forKey: .hitches)
            scrollOffset = try container.decode(Double.self, forKey: .scrollOffset)
            contentHeight = try container.decode(Double.self, forKey: .contentHeight)
            viewportHeight = try container.decode(Double.self, forKey: .viewportHeight)
            scrolled = try container.decode(Bool.self, forKey: .scrolled)
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(sessionId, forKey: .sessionId)
            try container.encodeIfPresent(openSeconds, forKey: .openSeconds)
            try container.encodeIfPresent(firstEventSeconds, forKey: .firstEventSeconds)
            try container.encodeIfPresent(catchUpSeconds, forKey: .catchUpSeconds)
            try container.encode(events, forKey: .events)
            try container.encode(lastSeq, forKey: .lastSeq)
            try container.encode(rows, forKey: .rows)
            try container.encode(scrollSeconds, forKey: .scrollSeconds)
            try container.encode(hitchSeconds, forKey: .hitchSeconds)
            try container.encode(hitches, forKey: .hitches)
            try container.encode(scrollOffset, forKey: .scrollOffset)
            try container.encode(contentHeight, forKey: .contentHeight)
            try container.encode(viewportHeight, forKey: .viewportHeight)
            try container.encode(scrolled, forKey: .scrolled)
            try container.encode(hitchRatio, forKey: .hitchRatio)
        }
    }

    @ObservationIgnored private let reportURL: URL
    @ObservationIgnored private let scrollsAfterOpening: Bool
    @ObservationIgnored private var scrollScriptStartsAt: CFTimeInterval?
    @ObservationIgnored private var report = Report()
    @ObservationIgnored private var frames = FrameClock()
    @ObservationIgnored private weak var measuredStore: TimelineStore?

    public init?(environment: [String: String]) {
        guard let path = environment["PICA_TIMELINE_METRICS_PATH"] else { return nil }
        reportURL = URL(filePath: path)
        scrollsAfterOpening = environment["PICA_TIMELINE_SCROLL_SCRIPT"] == "1"
    }

    /// Called when the list first appears with the whole history applied. The next turn of the main run loop comes
    /// after the frame that shows it has been committed.
    func timelineAppeared(_ store: TimelineStore) {
        guard store !== measuredStore else { return }
        measuredStore = store
        let openedAt = store.openedAt
        DispatchQueue.main.async {
            self.report = Report()
            self.frames = FrameClock()
            self.report.sessionId = store.sessionId
            self.report.openSeconds = Self.seconds(openedAt.duration(to: .now))
            self.report.firstEventSeconds = store.firstEventAt.map { Self.seconds(openedAt.duration(to: $0)) }
            self.report.catchUpSeconds = store.caughtUpAt.map { Self.seconds(openedAt.duration(to: $0)) }
            self.report.events = store.lastSeq
            self.report.lastSeq = store.lastSeq
            self.report.rows = store.entries.count
            self.write()
            if self.scrollsAfterOpening {
                self.scrollScriptStartsAt = CACurrentMediaTime() + ScrollScript.settle
            }
        }
    }

    /// True once, when a session has opened and settled, and the scroll script should start.
    func takeScrollScript(at timestamp: CFTimeInterval) -> Bool {
        guard let startsAt = scrollScriptStartsAt, timestamp >= startsAt else { return false }
        scrollScriptStartsAt = nil
        return true
    }

    func scrollScriptFinished() {
        report.scrolled = true
        write()
    }

    /// Called after each batch of events the open timeline applies.
    func applied(_ store: TimelineStore) {
        guard store === measuredStore else { return }
        report.lastSeq = store.lastSeq
        write()
    }

    func scrolled(from old: ScrollFollow.Geometry, to new: ScrollFollow.Geometry) {
        report.scrollOffset = new.offset
        report.contentHeight = new.contentHeight
        report.viewportHeight = new.viewportHeight
        guard old.offset != new.offset else { return }
        frames.lastScroll = CACurrentMediaTime()
    }

    /// One display-link callback: `timestamp` is the frame just shown, `targetTimestamp` the next one.
    func frame(timestamp: CFTimeInterval, targetTimestamp: CFTimeInterval) {
        switch frames.record(timestamp: timestamp, targetTimestamp: targetTimestamp) {
        case .idle: break
        case .scrolled(let duration, let late):
            report.scrollSeconds += duration
            if let late {
                report.hitchSeconds += late
                report.hitches += 1
            }
        case .stoppedScrolling: write()
        }
    }

    private func write() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(report) else { return }
        try? data.write(to: reportURL, options: .atomic)
    }

    private static func seconds(_ duration: Duration) -> Double {
        Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18
    }
}

/// Display-link frames sorted into scrolling and not. A frame is late, a hitch, when it is shown more than half a
/// frame after the time the previous callback was given for it, because the main thread was busy over a refresh.
struct FrameClock {
    enum Outcome: Equatable {
        case idle
        case scrolled(duration: Double, late: Double?)
        case stoppedScrolling
    }

    /// Scrolling counts as ongoing until this long after the offset last changed.
    static let scrollGrace: CFTimeInterval = 0.1

    var lastScroll: CFTimeInterval?
    private var previous: (timestamp: CFTimeInterval, target: CFTimeInterval)?
    private var wasScrolling = false

    mutating func record(timestamp: CFTimeInterval, targetTimestamp: CFTimeInterval) -> Outcome {
        defer { previous = (timestamp, targetTimestamp) }
        let scrolling = lastScroll.map { timestamp - $0 <= Self.scrollGrace } ?? false
        defer { wasScrolling = scrolling }
        guard let previous, scrolling else {
            return wasScrolling && !scrolling ? .stoppedScrolling : .idle
        }
        let frameDuration = previous.target - previous.timestamp
        let late = timestamp - previous.target
        return .scrolled(duration: timestamp - previous.timestamp, late: late > frameDuration / 2 ? late : nil)
    }
}
