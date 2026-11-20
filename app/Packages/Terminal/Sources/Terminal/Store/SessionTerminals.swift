import Foundation
import Observation
import PicaProtocol

/// The open terminal panels, one per session, kept while Pica runs so a shell survives switching sessions. Closing
/// a panel ends its shell; a shell that is ending is kept until it has exited and been reaped.
@MainActor
@Observable
public final class SessionTerminals {
    public private(set) var panels: [Id: SessionTerminal] = [:]

    @ObservationIgnored private let backend: any TerminalBackend
    @ObservationIgnored private let grace: Duration
    @ObservationIgnored private let launcher: @MainActor (String) -> ShellLaunch
    @ObservationIgnored private var ending: [ObjectIdentifier: TerminalShell] = [:]

    public init(
        backend: any TerminalBackend, grace: Duration = .seconds(2),
        launcher: @escaping @MainActor (String) -> ShellLaunch = ShellLaunch.system(directory:)
    ) {
        self.backend = backend
        self.grace = grace
        self.launcher = launcher
    }

    public func isOpen(_ sessionId: Id) -> Bool {
        panels[sessionId] != nil
    }

    /// The session's panel, opened if it was closed.
    @discardableResult
    public func open(_ sessionId: Id) -> SessionTerminal {
        if let panel = panels[sessionId] { return panel }
        let panel = SessionTerminal(sessionId: sessionId, backend: backend, launcher: launcher) { [weak self] shell in
            self?.retire(shell)
        }
        panels[sessionId] = panel
        return panel
    }

    public func close(_ sessionId: Id) {
        panels.removeValue(forKey: sessionId)?.end()
    }

    public func setOpen(_ isOpen: Bool, for sessionId: Id) {
        if isOpen {
            open(sessionId)
        } else {
            close(sessionId)
        }
    }

    /// Shells hung up and not yet exited.
    var endingCount: Int { ending.count }

    private func retire(_ shell: TerminalShell) {
        let key = ObjectIdentifier(shell)
        ending[key] = shell
        shell.end(grace: grace)
        shell.onExit { [weak self] in
            self?.ending[key] = nil
        }
    }
}
