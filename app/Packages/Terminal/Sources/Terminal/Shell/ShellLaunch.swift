import Darwin
import Foundation

/// How a terminal's shell is started (docs/terminal.md): the user's login shell, as a login shell, in the session's
/// directory, with an environment built for a terminal rather than Pica's own.
public struct ShellLaunch: Equatable, Sendable {
    public var executable: String
    /// `argv[0]`: the shell's name after a `-`, which makes it a login shell.
    public var execName: String
    /// `NAME=value` entries.
    public var environment: [String]
    public var directory: String

    /// The variables passed on from Pica's environment. Pica's own (`PICA_*`) and its engine's are not.
    static let inherited = ["HOME", "USER", "LOGNAME", "PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SSH_AUTH_SOCK"]
    static let fallbackShell = "/bin/zsh"

    /// `SHELL` from Pica's environment, else the account's shell, else zsh.
    public static func make(directory: String, environment: [String: String], accountShell: String?) -> ShellLaunch {
        let shell = [environment["SHELL"], accountShell].compactMap { $0 }.first { $0.hasPrefix("/") } ?? fallbackShell
        var variables = inherited.compactMap { name in environment[name].map { "\(name)=\($0)" } }
        if environment["LANG"] == nil {
            variables.append("LANG=en_US.UTF-8")
        }
        variables += [
            "SHELL=\(shell)",
            "PWD=\(directory)",
            "TERM=xterm-256color",
            "COLORTERM=truecolor",
            "TERM_PROGRAM=Pica",
        ]
        let name = URL(filePath: shell).lastPathComponent
        return ShellLaunch(executable: shell, execName: "-\(name)", environment: variables, directory: directory)
    }

    public static func system(directory: String) -> ShellLaunch {
        make(directory: directory, environment: ProcessInfo.processInfo.environment, accountShell: accountShell())
    }

    private static func accountShell() -> String? {
        guard let entry = getpwuid(getuid()), let shell = entry.pointee.pw_shell else { return nil }
        return String(cString: shell)
    }
}

/// What `waitpid` reported for an ended shell.
public enum ShellExit: Equatable, Sendable {
    case exited(code: Int32)
    case signaled(signal: Int32)
    /// The terminal could not start the shell or read from it.
    case failed

    public init(waitStatus: Int32?) {
        guard let status = waitStatus else {
            self = .failed
            return
        }
        let signal = status & 0x7f
        self = signal == 0 ? .exited(code: (status >> 8) & 0xff) : .signaled(signal: signal)
    }

    public var summary: String {
        switch self {
        case .exited(let code): "The shell exited with code \(code)."
        case .signaled(let signal): "The shell was ended by signal \(signal)."
        case .failed: "The shell could not be started."
        }
    }
}
