import Foundation
import Observation

/// How long the review took to draw a selected file's diff (PLAN.md §9: a 5,000-line diff in under 200 ms), from the
/// click that selected it to the first frame that shows it. Only the UI tests turn it on, with
/// `PICA_REVIEW_METRICS_PATH`; it writes one JSON report per file drawn there. Specified in docs/review.md.
@Observable @MainActor
public final class ReviewMetrics {
    public struct Report: Codable, Equatable, Sendable {
        public var path = ""
        public var lines = 0
        public var layout = ""
        public var renderSeconds: Double = 0

        public init() {}
    }

    @ObservationIgnored private let reportURL: URL
    @ObservationIgnored private var reports: [Report] = []

    public init?(environment: [String: String]) {
        guard let path = environment["PICA_REVIEW_METRICS_PATH"] else { return nil }
        reportURL = URL(filePath: path)
    }

    /// Called when a file's diff first appears. The next turn of the main run loop comes after the frame that shows it
    /// has been committed.
    func diffAppeared(path: String, lines: Int, layout: DiffLayout, selectedAt: ContinuousClock.Instant) {
        DispatchQueue.main.async {
            let elapsed = selectedAt.duration(to: .now)
            var report = Report()
            report.path = path
            report.lines = lines
            report.layout = layout.rawValue
            report.renderSeconds = Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
            self.reports.append(report)
            if let data = try? JSONEncoder().encode(self.reports) {
                try? data.write(to: self.reportURL, options: .atomic)
            }
        }
    }
}
