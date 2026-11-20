@testable import Terminal
import Darwin
import Foundation
import PicaProtocol
import Testing

@MainActor
@Suite(.serialized) struct SessionTerminalsTests {
    @Test func opensAShellInTheFirstRootAndClosingEndsIt() async throws {
        let first = try temporaryDirectory()
        let second = try temporaryDirectory()
        let backend = FakeTerminalBackend(roots: [
            SessionRoot(path: first, access: .write, repoId: "r1"),
            SessionRoot(path: second, access: .reference, repoId: nil),
        ])
        let terminals = SessionTerminals(backend: backend, grace: .seconds(10), launcher: plainShell(in:))

        let terminal = terminals.open("s1")
        await terminal.load()
        let shell = try #require(terminal.shell)
        let pid = try #require(shell.pid)
        #expect(shell.directory == first)
        #expect(terminals.isOpen("s1"))

        terminals.close("s1")

        #expect(!terminals.isOpen("s1"))
        #expect(terminals.endingCount == 1)
        try await waitUntil("the shell has exited") { terminals.endingCount == 0 }
        #expect(isGone(pid))
    }

    @Test func choosingAnotherRootReplacesTheShell() async throws {
        let first = try temporaryDirectory()
        let second = try temporaryDirectory()
        let backend = FakeTerminalBackend(roots: [
            SessionRoot(path: first, access: .write, repoId: "r1"),
            SessionRoot(path: second, access: .write, repoId: "r2"),
        ])
        let terminals = SessionTerminals(backend: backend, grace: .seconds(10), launcher: plainShell(in:))
        let terminal = terminals.open("s1")
        await terminal.load()
        let old = try #require(terminal.shell?.pid)

        terminal.start(in: second)

        #expect(terminal.shell?.directory == second)
        try await waitUntil("the old shell has exited") { terminals.endingCount == 0 }
        #expect(isGone(old))
        terminals.close("s1")
        try await waitUntil("the new shell has exited") { terminals.endingCount == 0 }
    }

    @Test func aSessionWithNoRootsSaysSo() async {
        let terminals = SessionTerminals(backend: FakeTerminalBackend(roots: []), launcher: plainShell(in:))
        let terminal = terminals.open("s1")
        await terminal.load()
        #expect(terminal.shell == nil)
        #expect(terminal.failure == "This session has no repository to open a shell in.")
    }

    @Test func eachSessionKeepsItsOwnPanel() {
        let terminals = SessionTerminals(backend: FakeTerminalBackend(roots: []), launcher: plainShell(in:))
        let panel = terminals.open("s1")
        #expect(terminals.open("s1") === panel)
        terminals.open("s2")
        terminals.close("s1")
        #expect(!terminals.isOpen("s1"))
        #expect(terminals.isOpen("s2"))
    }
}
