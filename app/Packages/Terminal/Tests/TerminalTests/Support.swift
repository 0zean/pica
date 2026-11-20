@testable import Terminal
import Darwin
import Foundation
import PicaProtocol

/// `/bin/sh` without a profile, so what it prints depends only on the test.
func plainShell(in directory: String) -> ShellLaunch {
    ShellLaunch(
        executable: "/bin/sh", execName: "sh", environment: ["PATH=/usr/bin:/bin", "PS1=$ ", "PWD=\(directory)"],
        directory: directory)
}

func temporaryDirectory() throws -> String {
    let url = FileManager.default.temporaryDirectory.appending(path: "pica-terminal-\(UUID().uuidString.prefix(8))")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url.resolvingSymlinksInPath().path
}

struct TimedOut: Error {
    let description: String
}

/// Waits for `condition` while the main queue runs SwiftTerm's reads and exit handling.
@MainActor
func waitUntil(_ description: String, timeout: Duration = .seconds(10), _ condition: () -> Bool) async throws {
    let deadline = ContinuousClock.now + timeout
    while !condition() {
        guard ContinuousClock.now < deadline else { throw TimedOut(description: description) }
        try await Task.sleep(for: .milliseconds(20))
    }
}

/// True once `pid` names no process, not even one waiting to be reaped.
func isGone(_ pid: pid_t) -> Bool {
    kill(pid, 0) == -1 && errno == ESRCH
}

final class FakeTerminalBackend: TerminalBackend, @unchecked Sendable {
    let roots: [SessionRoot]
    let failure: (any Error)?

    init(roots: [SessionRoot], failure: (any Error)? = nil) {
        self.roots = roots
        self.failure = failure
    }

    func roots(sessionId: Id) async throws -> [SessionRoot] {
        if let failure { throw failure }
        return roots
    }
}
