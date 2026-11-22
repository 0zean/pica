@testable import AppShell
import Foundation
import Testing

/// The engine gets the login shell's `PATH` when Pica is opened from Finder (`docs/app-shell.md#the-engines-path`).
@Suite(.timeLimit(.minutes(1))) struct LoginShellPathTests {
    @Test func parseReadsBetweenMarkersAndIgnoresNoise() {
        let output = "Last login: today\nwelcome!\nMARK/opt/homebrew/bin:/usr/bin\nMARKbye\n"
        #expect(LoginShellPath.parse(output, marker: "MARK") == "/opt/homebrew/bin:/usr/bin")
        #expect(LoginShellPath.parse("no markers here", marker: "MARK") == nil)
        #expect(LoginShellPath.parse("MARK/usr/bin", marker: "MARK") == nil, "an unterminated answer is not used")
        #expect(LoginShellPath.parse("MARK \n MARK", marker: "MARK") == nil)
    }

    @Test func resolvedPathGoesFirstAndKeepsCurrentEntriesItLacks() {
        let path = LoginShellPath.merged(
            resolved: "/opt/homebrew/bin:/usr/bin:/bin", current: "/usr/bin:/bin:/usr/sbin:/sbin", home: "/Users/u",
            exists: { _ in true })
        #expect(path == "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin")
    }

    @Test func fallbackPrependsCommonDirectoriesThatExist() {
        let existing: Set = ["/opt/homebrew/bin", "/Users/u/.local/bin", "/usr/bin"]
        let path = LoginShellPath.merged(
            resolved: nil, current: LoginShellPath.launchdDefault, home: "/Users/u", exists: existing.contains)
        #expect(path == "/opt/homebrew/bin:/Users/u/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        let empty = LoginShellPath.merged(resolved: "", current: nil, home: "/Users/u", exists: { _ in false })
        #expect(empty == LoginShellPath.launchdDefault, "an empty answer falls back too; no PATH means launchd's")
    }

    @Test func shellIsSHELLThenAccountThenZsh() {
        #expect(LoginShellPath.shellPath(environment: ["SHELL": "/bin/bash"], accountShell: "/bin/zsh") == "/bin/bash")
        #expect(LoginShellPath.shellPath(environment: ["SHELL": "bash"], accountShell: "/opt/fish") == "/opt/fish")
        #expect(LoginShellPath.shellPath(environment: [:], accountShell: nil) == "/bin/zsh")
    }

    @Test func queryRunsTheShellAndIgnoresWhatItsRcFilesPrint() async throws {
        let scripts = try Scripts()
        defer { scripts.remove() }
        let shell = try scripts.shell("echo 'motd'; echo 'warning' >&2; /bin/sh -c \"$4\"; echo trailing")
        let path = await LoginShellPath.query(
            shell: shell, environment: ["PATH": "/opt/fake/bin:/usr/bin", "HOME": scripts.directory.path], timeout: .seconds(5))
        #expect(path == "/opt/fake/bin:/usr/bin")
    }

    @Test func queryGivesUpOnASlowShellWithinTheTimeout() async throws {
        let scripts = try Scripts()
        defer { scripts.remove() }
        let shell = try scripts.shell("echo starting; sleep 30")
        let started = ContinuousClock.now
        let path = await LoginShellPath.query(
            shell: shell, environment: ["HOME": scripts.directory.path], timeout: .milliseconds(300))
        #expect(path == nil)
        #expect(ContinuousClock.now - started < .seconds(3))
    }

    @Test func queryOfAMissingOrFailingShellIsNil() async throws {
        let scripts = try Scripts()
        defer { scripts.remove() }
        #expect(await LoginShellPath.query(shell: "/nonexistent/shell", environment: [:], timeout: .seconds(2)) == nil)
        let failing = try scripts.shell("exit 3")
        #expect(await LoginShellPath.query(shell: failing, environment: [:], timeout: .seconds(2)) == nil)
    }

    @Test func realZshAnswers() async throws {
        guard FileManager.default.isExecutableFile(atPath: "/bin/zsh") else { return }
        let scripts = try Scripts()
        defer { scripts.remove() }
        // An empty home: no rc files but the system's, which run path_helper.
        let path = await LoginShellPath.query(
            shell: "/bin/zsh", environment: ["PATH": LoginShellPath.launchdDefault, "HOME": scripts.directory.path],
            timeout: .seconds(10))
        #expect(LoginShellPath.entries(path ?? "").contains("/usr/bin"), "zsh answered \(path ?? "nothing")")
    }

    /// Launched as from Finder (launchd's `PATH`), the engine process sees the login shell's `PATH`.
    @Test func engineStartedFromAMinimalPathGetsTheResolvedOne() async throws {
        let scripts = try Scripts()
        defer { scripts.remove() }
        // A profile that puts /opt/fake/bin first, as Homebrew's `brew shellenv` does.
        let shell = try scripts.shell("PATH=/opt/fake/bin:/usr/bin /bin/sh -c \"$4\"")
        let environment = await LoginShellPath.engineEnvironment(
            ["PATH": LoginShellPath.launchdDefault, "HOME": scripts.directory.path, "SHELL": shell],
            timeout: .seconds(5), accountShell: nil)
        #expect(environment["PATH"] == "/opt/fake/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        #expect(environment["HOME"] == scripts.directory.path, "the rest of the environment is kept")

        // A stand-in engine that logs its PATH to stderr (picad.log) and prints the ready line.
        let engine = EngineCommand(
            executable: URL(filePath: "/bin/sh"),
            arguments: ["-c", #"/usr/bin/printenv PATH >&2; echo '{"ready":true}'; sleep 5"#, "engine"])
        let log = scripts.directory.appending(path: "run/picad.log")
        let process = try EngineProcess.start(
            engine, socketPath: scripts.directory.appending(path: "run/picad.sock").path, logURL: log,
            baseEnvironment: environment)
        #expect(await process.waitUntilReady(timeout: .seconds(5), clock: ContinuousClock()) == .ready)
        process.kill()
        _ = await process.waitForExit()
        #expect(process.lastLogMessage() == "/opt/fake/bin:/usr/bin:/bin:/usr/sbin:/sbin")
    }
}

/// Fake shells: each is a `/bin/sh` script run as `<shell> -l -i -c <command>`, so the command is `$4`.
private struct Scripts {
    let directory: URL

    init() throws {
        directory = URL(filePath: "/tmp").appending(path: "pica-path-\(UUID().uuidString.prefix(8))")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func shell(_ body: String) throws -> String {
        let url = directory.appending(path: "shell-\(UUID().uuidString.prefix(6))")
        try Data("#!/bin/sh\n\(body)\n".utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url.path
    }

    func remove() {
        try? FileManager.default.removeItem(at: directory)
    }
}
