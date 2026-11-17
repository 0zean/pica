import PicaProtocol
import Testing
@testable import Review

/// The parts of drawing a 5,000-line diff that do not depend on SwiftUI: building its rows and the first screen's
/// syntax states. The whole
/// budget, click to frame, is `ReviewUITests.testA5000LineDiffRendersInUnder200Milliseconds`.
@MainActor
@Suite struct DiffPerformanceTests {
    static func largeDiff(lines: Int) -> FileDiff {
        let half = lines / 2
        var diffLines: [DiffLine] = []
        diffLines.reserveCapacity(lines)
        for index in 0..<half {
            diffLines.append(DiffLine(kind: .removed, text: "    let value\(index) = compute(\(index)) // old", oldLine: index + 1, newLine: nil))
        }
        for index in 0..<half {
            diffLines.append(DiffLine(kind: .added, text: "    let value\(index) = compute(\(index), \"fast\") // new", oldLine: nil, newLine: index + 1))
        }
        let hunk = DiffHunk(header: "@@ -1,\(half) +1,\(half) @@", lines: diffLines)
        return FileDiff(path: "Sources/Big.swift", originalPath: nil, change: .modified, binary: false, hunks: [hunk])
    }

    @Test func buildingA5000LineDiffTakesAFractionOfTheBudget() {
        let file = Self.largeDiff(lines: 5_000)
        let clock = ContinuousClock()
        var document: DiffDocument?
        let elapsed = clock.measure { document = DiffDocument(file: file) }
        #expect(document?.lineCount == 5_000)
        #expect(document?.split.count == 2_501)
        // Debug builds; the 200 ms budget also covers layout and the first frame.
        print("A-08: building a 5,000-line diff took \(elapsed)")
        #expect(elapsed < .milliseconds(100), "building took \(elapsed)")
    }
}
