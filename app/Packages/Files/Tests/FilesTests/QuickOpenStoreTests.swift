@testable import Files
import Foundation
import PicaProtocol
import Testing

@MainActor
@Suite struct QuickOpenStoreTests {
    let backend = FakeFilesBackend()

    func store() -> QuickOpenStore {
        let store = QuickOpenStore(backend: backend)
        store.begin(workspaceId: "w1", repos: backend.repoList)
        return store
    }

    @Test func eachKeystrokeSearchesAndNamesTheRepo() async throws {
        backend.hits["ma"] = [QuickOpenHit(repoId: "r1", path: "src/main.swift", score: 90)]
        let store = store()
        store.setQuery("m")
        store.setQuery("ma")
        try await waitUntil { store.answeredQuery == "ma" }
        #expect(store.rows.map(\.reference) == [FileReference(repoId: "r1", repoName: "atlas", path: "src/main.swift", repoPath: "/work/atlas")])
        #expect(store.rows.first?.directory == "src")
        #expect(store.rows.first?.reference.fileURL?.path == "/work/atlas/src/main.swift")
    }

    @Test func keystrokesDuringASearchSendOnlyTheNewestNext() async throws {
        backend.holdSearches = true
        backend.hits["abc"] = [QuickOpenHit(repoId: "r2", path: "abc.swift", score: 1)]
        let store = store()
        store.setQuery("a")
        try await waitUntil { backend.heldCount == 1 }
        store.setQuery("ab")
        store.setQuery("abc")
        backend.release()
        try await waitUntil { backend.heldCount == 1 }
        backend.release()
        try await waitUntil { store.answeredQuery == "abc" }
        // The empty query lists the repos when the panel opens; it is sent apart from the keystrokes, so it may arrive
        // after the first one.
        #expect(backend.queries.contains(""))
        #expect(backend.queries.filter { !$0.isEmpty } == ["a", "abc"])
        #expect(store.rows.map(\.reference.path) == ["abc.swift"])
    }

    @Test func arrowsMoveAndWrapAndTheSelectionFollowsTheFile() async throws {
        backend.hits["s"] = ["a.swift", "b.swift", "c.swift"].map { QuickOpenHit(repoId: "r1", path: $0, score: 1) }
        backend.hits["sw"] = ["b.swift", "c.swift"].map { QuickOpenHit(repoId: "r1", path: $0, score: 1) }
        let store = store()
        store.setQuery("s")
        try await waitUntil { store.answeredQuery == "s" }
        store.moveSelection(by: -1)
        #expect(store.selectedReference?.path == "c.swift")
        store.moveSelection(by: 1)
        #expect(store.selectedReference?.path == "a.swift")
        store.moveSelection(by: 1)
        store.setQuery("sw")
        try await waitUntil { store.answeredQuery == "sw" }
        #expect(store.selectedReference?.path == "b.swift")
    }

    @Test func saysWhenNothingMatchesOrThereIsNoWorkspace() async throws {
        let store = store()
        store.setQuery("zzz")
        try await waitUntil { store.answeredQuery == "zzz" }
        #expect(store.message == "No files match “zzz”.")
        store.setQuery("")
        #expect(store.message == nil)

        store.begin(workspaceId: nil, repos: [])
        #expect(store.message == "Select a workspace to search its files.")
    }
}
