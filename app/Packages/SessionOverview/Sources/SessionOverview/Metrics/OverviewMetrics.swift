import Darwin
import Foundation

/// The app's CPU use while the board is open and nothing changes (PLAN.md §9's idle budget). Only the UI tests turn
/// it on, with `PICA_OVERVIEW_METRICS_PATH`. Once the board has shown for `settle`, it measures the app's own CPU time
/// (user and system, every thread) over `window` and writes one JSON report. The engine is another process and is not
/// counted. Specified in docs/session-overview.md.
@MainActor
public final class OverviewMetrics {
    public struct Report: Codable, Equatable, Sendable {
        /// Sessions on the board when the measuring started.
        public var sessions: Int
        public var queued: Int
        public var cpuSeconds: Double
        public var wallSeconds: Double
        /// How many times the board's contents changed while measuring.
        public var boardChanges: Int
        /// CPU time over wall time: 0.01 is 1% of one core.
        public var cpuFraction: Double { wallSeconds > 0 ? cpuSeconds / wallSeconds : 0 }

        private enum CodingKeys: String, CodingKey {
            case sessions, queued, cpuSeconds, wallSeconds, boardChanges, cpuFraction
        }

        public init(sessions: Int, queued: Int, cpuSeconds: Double, wallSeconds: Double, boardChanges: Int) {
            self.sessions = sessions
            self.queued = queued
            self.cpuSeconds = cpuSeconds
            self.wallSeconds = wallSeconds
            self.boardChanges = boardChanges
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            sessions = try container.decode(Int.self, forKey: .sessions)
            queued = try container.decode(Int.self, forKey: .queued)
            cpuSeconds = try container.decode(Double.self, forKey: .cpuSeconds)
            wallSeconds = try container.decode(Double.self, forKey: .wallSeconds)
            boardChanges = try container.decode(Int.self, forKey: .boardChanges)
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(sessions, forKey: .sessions)
            try container.encode(queued, forKey: .queued)
            try container.encode(cpuSeconds, forKey: .cpuSeconds)
            try container.encode(wallSeconds, forKey: .wallSeconds)
            try container.encode(boardChanges, forKey: .boardChanges)
            try container.encode(cpuFraction, forKey: .cpuFraction)
        }
    }

    private let reportURL: URL
    private let settle: Duration
    private let window: Duration
    private var measuring: Task<Void, Never>?
    private var boardChanges = 0
    private var shown = (total: 0, queued: 0)

    public convenience init?(environment: [String: String]) {
        guard let path = environment["PICA_OVERVIEW_METRICS_PATH"], !path.isEmpty else { return nil }
        let seconds = { (key: String, fallback: Double) in
            Duration.seconds(environment[key].flatMap(Double.init) ?? fallback)
        }
        self.init(
            reportURL: URL(filePath: path), settle: seconds("PICA_OVERVIEW_METRICS_SETTLE", 3),
            window: seconds("PICA_OVERVIEW_METRICS_WINDOW", 10))
    }

    init(reportURL: URL, settle: Duration, window: Duration) {
        self.reportURL = reportURL
        self.settle = settle
        self.window = window
    }

    /// Starts one measurement the first time the board appears.
    func boardAppeared(total: Int, queued: Int) {
        shown = (total, queued)
        guard measuring == nil else { return }
        let settle = settle
        let window = window
        measuring = Task { [weak self] in
            try? await Task.sleep(for: settle)
            guard let self else { return }
            boardChanges = 0
            let startCPU = Self.cpuSeconds()
            let startWall = ContinuousClock.now
            try? await Task.sleep(for: window)
            let wall = ContinuousClock.now - startWall
            let report = Report(
                sessions: shown.total, queued: shown.queued, cpuSeconds: Self.cpuSeconds() - startCPU,
                wallSeconds: Double(wall.components.seconds) + Double(wall.components.attoseconds) / 1e18,
                boardChanges: boardChanges)
            try? JSONEncoder().encode(report).write(to: reportURL, options: .atomic)
        }
    }

    func boardChanged(total: Int, queued: Int) {
        shown = (total, queued)
        boardChanges += 1
    }

    /// The process's CPU time so far, user and system.
    static func cpuSeconds() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        let seconds = { (time: timeval) in Double(time.tv_sec) + Double(time.tv_usec) / 1_000_000 }
        return seconds(usage.ru_utime) + seconds(usage.ru_stime)
    }
}
