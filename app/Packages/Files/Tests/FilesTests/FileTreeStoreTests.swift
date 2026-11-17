@testable import Files
import Foundation
import PicaProtocol
import Testing

@MainActor
@Suite struct FileTreeStoreTests {
    let backend = FakeFilesBackend()

    @Test func directoriesListTheirChildrenWhenFirstExpanded() async throws {
        let store = FileTreeStore(backend: backend)
        await store.load(workspaceId: "w1")
        #expect(store.rows.map(\.id) == ["r1:", "r2:"])
        await store.toggle(try #require(store.rows.first))
        #expect(store.rows.map(\.id) == ["r1:", "r1:src", "r1:README.md", "r2:"])
        await store.toggle(try #require(store.rows.first { $0.id == "r1:src" }))
        #expect(store.rows.map(\.id) == ["r1:", "r1:src", "r1:src/main.swift", "r1:README.md", "r2:"])
        #expect(store.rows.map(\.depth) == [0, 1, 2, 1, 0])

        // Collapsing hides the children and expanding again shows them without listing again.
        await store.toggle(try #require(store.rows.first))
        #expect(store.rows.map(\.id) == ["r1:", "r2:"])
        await store.toggle(try #require(store.rows.first))
        #expect(store.rows.count == 5)
        #expect(backend.listed == ["r1:", "r1:src"])
    }

    @Test func aSingleRepoOpensAtOnce() async {
        backend.repoList = [backend.repoList[0]]
        let store = FileTreeStore(backend: backend)
        await store.load(workspaceId: "w1")
        #expect(store.rows.map(\.id) == ["r1:", "r1:src", "r1:README.md"])
    }

    @Test func aFileIsAReferenceAndAFailedListingIsKept() async throws {
        backend.listings["r2:"] = nil
        let store = FileTreeStore(backend: backend)
        await store.load(workspaceId: "w1")
        await store.toggle(try #require(store.rows.last))
        #expect(store.failures["r2:"] != nil)
        await store.toggle(try #require(store.rows.first))
        let readme = try #require(store.rows.first { $0.id == "r1:README.md" })
        #expect(store.reference(for: readme) == FileReference(repoId: "r1", repoName: "atlas", path: "README.md", repoPath: "/work/atlas"))
        #expect(store.reference(for: store.rows[0]) == nil)
    }
}

@MainActor
@Suite struct FileViewerStoreTests {
    let backend = FakeFilesBackend()

    @Test func readsTheTextAndSaysWhenItIsBinary() async {
        backend.files["r1:README.md"] = FilesReadResult(text: "# Atlas\n", truncated: false, sizeBytes: 8)
        let text = FileViewerStore(reference: FileReference(repoId: "r1", repoName: "atlas", path: "README.md", repoPath: nil), backend: backend)
        await text.load()
        #expect(text.content == .text("# Atlas\n", truncated: false, sizeBytes: 8))

        let binary = FileViewerStore(reference: FileReference(repoId: "r1", repoName: "atlas", path: "logo.png", repoPath: nil), backend: backend)
        await binary.load()
        #expect(binary.content == .unavailable("This is a binary file, which the viewer does not show."))
    }
}
