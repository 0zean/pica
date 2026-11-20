@testable import Terminal
import Testing

@Suite struct ShellLaunchTests {
    @Test func startsTheUsersShellAsALoginShellInTheDirectory() {
        let launch = ShellLaunch.make(
            directory: "/work/atlas", environment: ["SHELL": "/opt/homebrew/bin/fish", "HOME": "/Users/ada"],
            accountShell: "/bin/zsh")
        #expect(launch.executable == "/opt/homebrew/bin/fish")
        #expect(launch.execName == "-fish")
        #expect(launch.directory == "/work/atlas")
        #expect(launch.environment.contains("PWD=/work/atlas"))
        #expect(launch.environment.contains("SHELL=/opt/homebrew/bin/fish"))
        #expect(launch.environment.contains("HOME=/Users/ada"))
        #expect(launch.environment.contains("TERM=xterm-256color"))
    }

    @Test func fallsBackToTheAccountShellThenZsh() {
        #expect(ShellLaunch.make(directory: "/w", environment: [:], accountShell: "/bin/bash").executable == "/bin/bash")
        #expect(ShellLaunch.make(directory: "/w", environment: ["SHELL": "fish"], accountShell: nil).executable == "/bin/zsh")
    }

    @Test func passesOnlyATerminalsVariables() {
        let launch = ShellLaunch.make(
            directory: "/w",
            environment: ["PATH": "/usr/bin:/bin", "PICA_SOCKET": "/tmp/picad.sock", "NODE_OPTIONS": "--inspect", "LANG": "fr_FR.UTF-8"],
            accountShell: "/bin/zsh")
        #expect(launch.environment.contains("PATH=/usr/bin:/bin"))
        #expect(launch.environment.contains("LANG=fr_FR.UTF-8"))
        #expect(!launch.environment.contains { $0.hasPrefix("PICA_") || $0.hasPrefix("NODE_OPTIONS") })
        #expect(launch.environment.filter { $0.hasPrefix("LANG=") }.count == 1)
    }

    @Test(arguments: [
        (Int32?.none, ShellExit.failed),
        (Int32(0), ShellExit.exited(code: 0)),
        (Int32(3 << 8), ShellExit.exited(code: 3)),
        (Int32(1), ShellExit.signaled(signal: 1)),
        (Int32(9), ShellExit.signaled(signal: 9)),
    ])
    func readsWaitStatuses(status: Int32?, exit: ShellExit) {
        #expect(ShellExit(waitStatus: status) == exit)
    }
}
