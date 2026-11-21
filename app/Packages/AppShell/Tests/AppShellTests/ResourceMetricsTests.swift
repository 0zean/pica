@testable import AppShell
import Foundation
import Testing

/// H-07: `ResourceMetrics` answers a request file with a report of the app's CPU use and memory.
@Suite(.timeLimit(.minutes(1))) struct ResourceMetricsTests {
    @MainActor @Test func aRequestFileIsAnsweredWithOneReport() async throws {
        let folder = URL(filePath: NSTemporaryDirectory()).appending(path: "pica-resources-\(UUID().uuidString.prefix(8))")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let reportURL = folder.appending(path: "resources.json")
        let metrics = try #require(ResourceMetrics(environment: ["PICA_RESOURCE_METRICS_PATH": reportURL.path]))
        metrics.start()
        defer { metrics.stop() }

        try Data("0.2".utf8).write(to: reportURL.appendingPathExtension("request"))
        var report: ResourceMetrics.Report?
        for _ in 0..<100 where report == nil {
            try await Task.sleep(for: .milliseconds(50))
            report = try? JSONDecoder().decode(ResourceMetrics.Report.self, from: Data(contentsOf: reportURL))
        }
        let measured = try #require(report)
        #expect(measured.wallSeconds >= 0.2)
        #expect(measured.footprintBytes > 0)
        #expect(measured.peakFootprintBytes >= measured.footprintBytes)
        #expect(!FileManager.default.fileExists(atPath: reportURL.appendingPathExtension("request").path))
    }

    @Test func itIsOffWithoutItsVariable() async {
        #expect(await ResourceMetrics(environment: [:]) == nil)
    }
}
