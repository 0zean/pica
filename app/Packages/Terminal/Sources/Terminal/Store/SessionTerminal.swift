import Foundation
import Observation
import PicaProtocol

/// A session's terminal panel (docs/terminal.md): the directories the session works in, and the shell running in
/// one of them, the first by default. Changing directory or starting a new shell ends the old one.
@MainActor
@Observable
public final class SessionTerminal {
    public let sessionId: Id
    public private(set) var roots: [SessionRoot] = []
    public private(set) var shell: TerminalShell?
    public private(set) var failure: String?

    @ObservationIgnored private let backend: any TerminalBackend
    @ObservationIgnored private let launcher: @MainActor (String) -> ShellLaunch
    @ObservationIgnored private let retire: @MainActor (TerminalShell) -> Void

    init(
        sessionId: Id, backend: any TerminalBackend, launcher: @escaping @MainActor (String) -> ShellLaunch,
        retire: @escaping @MainActor (TerminalShell) -> Void
    ) {
        self.sessionId = sessionId
        self.backend = backend
        self.launcher = launcher
        self.retire = retire
    }

    /// Asks the engine where the session works and starts a shell in the first root, unless one is running.
    public func load() async {
        do {
            roots = try await backend.roots(sessionId: sessionId)
            failure = roots.isEmpty ? "This session has no repository to open a shell in." : nil
        } catch {
            roots = []
            failure = error.localizedDescription
        }
        if shell == nil, let first = roots.first {
            start(in: first.path)
        }
    }

    /// Starts a shell in `directory`, ending the one running elsewhere.
    public func start(in directory: String) {
        if let shell, shell.directory == directory, shell.isRunning { return }
        endShell()
        shell = TerminalShell(launch: launcher(directory))
    }

    /// A new shell where the last one was, after it exited.
    public func restart() {
        guard let directory = shell?.directory ?? roots.first?.path else { return }
        endShell()
        shell = TerminalShell(launch: launcher(directory))
    }

    func end() {
        endShell()
    }

    private func endShell() {
        if let shell {
            retire(shell)
        }
        shell = nil
    }
}
