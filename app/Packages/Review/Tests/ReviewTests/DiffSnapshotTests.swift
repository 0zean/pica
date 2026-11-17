import DesignSystem
import DesignSystemTestSupport
import Foundation
import PicaProtocol
import SwiftUI
import Testing
@testable import Review

/// PLAN.md A-08: snapshots of diffs the engine sends for the R-01 fixture repository: a modified file, a rename, a
/// deletion, a binary file, a submodule and an untracked file. `Fixtures/` holds `git.diff`'s answers for it, which
/// `engine/packages/server/tests/review/git-rpc.test.ts` checks against the engine.
@MainActor
@Suite struct DiffSnapshotTests {
    private let location = SnapshotLocation(testFile: #filePath)

    nonisolated static func fixture(_ name: String) throws -> [FileDiff] {
        let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(GitDiffResult.self, from: Data(contentsOf: url)).files
    }

    nonisolated static func cases() throws -> [(String, ReviewFile.Side, String)] {
        try fixture("fixture-staged").map { ("fixture-staged", .staged, $0.path) }
            + fixture("fixture-unstaged").map { ("fixture-unstaged", .unstaged, $0.path) }
    }

    @Test func theFixturesCoverRenamesBinaryFilesAndTheOtherChanges() throws {
        let files = try Self.fixture("fixture-staged") + Self.fixture("fixture-unstaged")
        #expect(Set(files.map(\.change)) == [.deleted, .renamed, .modified, .untracked])
        #expect(files.contains { $0.binary })
        #expect(files.contains { $0.change == .renamed && $0.originalPath == "old-name.txt" })
    }

    @Test(arguments: try cases())
    func eachFixtureFileMatchesReference(fixture: String, side: ReviewFile.Side, path: String) throws {
        let diff = try #require(try Self.fixture(fixture).first { $0.path == path })
        let name = "diff-\(side.rawValue)-\(path.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: " ", with: "_"))"
        Snapshot.assertMatchesReference(Self.render(diff, side: side, .unified, .light), named: name, in: location)
    }

    @Test func aSplitDiffMatchesReference() throws {
        let diff = try #require(try Self.fixture("fixture-unstaged").first { $0.path == "notes.txt" })
        Snapshot.assertMatchesReference(Self.render(diff, side: .unstaged, .split, .light), named: "diff-split-notes.txt", in: location)
    }

    @Test(arguments: [Appearance.light, .dark, .lightIncreasedContrast, .darkIncreasedContrast])
    func highlightedCodeMatchesReferenceInEachAppearance(_ appearance: Appearance) {
        Snapshot.assertMatchesReference(
            Self.render(Self.swiftChange, side: .unstaged, .unified, appearance),
            named: "diff-highlighted-\(appearance.snapshotName)", in: location)
    }

    static let swiftChange = FileDiff(
        path: "Sources/Router/Route.swift", originalPath: nil, change: .modified, binary: false,
        hunks: [
            DiffHunk(header: "@@ -10,6 +10,7 @@ struct Route", lines: [
                DiffLine(kind: .context, text: "    /// Picks the tier for a call.", oldLine: 10, newLine: 10),
                DiffLine(kind: .context, text: "    func tier(for call: Call) -> Tier {", oldLine: 11, newLine: 11),
                DiffLine(kind: .removed, text: "        if call.bytes > 4096 { return .worker }", oldLine: 12, newLine: nil),
                DiffLine(kind: .added, text: "        let limit = 32_768 // C-04", oldLine: nil, newLine: 12),
                DiffLine(kind: .added, text: "        if call.bytes > limit { return .worker }", oldLine: nil, newLine: 13),
                DiffLine(kind: .context, text: "        return .reasoning", oldLine: 13, newLine: 14),
                DiffLine(kind: .context, text: "    }", oldLine: 14, newLine: 15),
                DiffLine(kind: .context, text: "    let name = \"route\"", oldLine: 15, newLine: 16),
            ]),
        ])

    static func render(_ diff: FileDiff, side: ReviewFile.Side, _ layout: DiffLayout, _ appearance: Appearance) -> Bitmap {
        let file = ReviewFile(side: side, diff: diff)
        return Snapshot.render(DiffSnapshotContent(document: DiffDocument(file: diff), file: file, layout: layout), width: 640, appearance: appearance)
    }
}

/// The file header and the rows in a plain stack, as the pane lays them out.
private struct DiffSnapshotContent: View {
    let document: DiffDocument
    let file: ReviewFile
    @State var layout: DiffLayout

    var body: some View {
        VStack(spacing: 0) {
            DiffFileHeader(file: file, layout: $layout, actions: ReviewActions())
            Divider()
            if let placeholder = document.placeholder {
                DiffPlaceholder(text: placeholder).frame(maxWidth: .infinity)
            } else {
                VStack(spacing: 0) {
                    DiffRows(document: document, file: file, layout: layout, actions: ReviewActions())
                }
            }
        }
    }
}
