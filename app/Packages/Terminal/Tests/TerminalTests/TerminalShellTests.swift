@testable import Terminal
import Darwin
import Foundation
import Testing

/// Real shells in a pseudo-terminal.
@MainActor
@Suite(.serialized) struct TerminalShellTests {
    @Test func runsInTheDirectoryAndShowsWhatCommandsPrint() async throws {
        let directory = try temporaryDirectory()
        let shell = TerminalShell(launch: plainShell(in: directory))
        defer { shell.end(grace: .milliseconds(100)) }
        #expect(shell.isRunning)

        shell.send("pwd; echo pica-$((6*7))\n")

        try await waitUntil("the output is on screen") { shell.screenText.contains("pica-42") }
        let lines = shell.screenText.split(separator: "\n").map(String.init)
        #expect(lines.contains(directory))
    }

    @Test func endingHangsUpTheShellAndItIsReaped() async throws {
        let shell = TerminalShell(launch: plainShell(in: try temporaryDirectory()))
        let pid = try #require(shell.pid)

        shell.end(grace: .seconds(10))

        try await waitUntil("the shell has exited") { shell.pid == nil }
        #expect(shell.state == .ended(.signaled(signal: SIGHUP)))
        #expect(isGone(pid))
    }

    @Test func aShellThatIgnoresTheHangUpIsKilledAfterTheGracePeriod() async throws {
        let shell = TerminalShell(launch: plainShell(in: try temporaryDirectory()))
        let pid = try #require(shell.pid)
        shell.send("trap '' HUP; echo trapped-$((1+1))\n")
        try await waitUntil("the trap is set") { shell.screenText.contains("trapped-2") }

        shell.end(grace: .milliseconds(200))

        try await waitUntil("the shell has exited") { shell.pid == nil }
        #expect(shell.state == .ended(.signaled(signal: SIGKILL)))
        #expect(isGone(pid))
    }

    @Test func aShellThatExitsReportsItsCode() async throws {
        let shell = TerminalShell(launch: plainShell(in: try temporaryDirectory()))
        var exited = false
        shell.onExit { exited = true }

        shell.send("exit 3\n")

        try await waitUntil("the shell has exited") { exited }
        #expect(shell.state == .ended(.exited(code: 3)))
    }
}
