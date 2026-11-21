@testable import SessionOverview
import Foundation
import Testing

@MainActor
@Suite struct OverviewMetricsTests {
    @Test func itIsOffUnlessTheUITestsAskForIt() {
        #expect(OverviewMetrics(environment: [:]) == nil)
        #expect(OverviewMetrics(environment: ["PICA_OVERVIEW_METRICS_PATH": "/tmp/x.json"]) != nil)
    }

    @Test func itWritesOneReportOfTheBoardAndTheCPUTimeOverTheWindow() async throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "overview-metrics-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let metrics = OverviewMetrics(reportURL: url, settle: .milliseconds(10), window: .milliseconds(200))
        metrics.boardAppeared(total: 20, queued: 4)
        metrics.boardAppeared(total: 1, queued: 0)
        try await Task.sleep(for: .milliseconds(50))
        metrics.boardChanged(total: 20, queued: 3)
        var report: OverviewMetrics.Report?
        for _ in 0..<100 where report == nil {
            try await Task.sleep(for: .milliseconds(20))
            report = try? JSONDecoder().decode(OverviewMetrics.Report.self, from: Data(contentsOf: url))
        }
        let written = try #require(report)
        #expect(written.boardChanges == 1)
        #expect(written.wallSeconds >= 0.2)
        #expect(written.cpuSeconds >= 0)
        #expect(written.cpuFraction == written.cpuSeconds / written.wallSeconds)
    }
}
