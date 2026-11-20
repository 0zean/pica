import AppKit
import Darwin
import Observation
import SwiftTerm

/// One shell in a pseudo-terminal, and the view that shows it. The shell's process is Pica's child: `end` hangs it
/// up as closing a terminal window does, and kills it if it is still there after the grace period.
@MainActor
@Observable
public final class TerminalShell {
    public enum State: Equatable, Sendable {
        case running(pid: pid_t)
        /// Hung up, waiting for it to exit.
        case ending(pid: pid_t)
        case ended(ShellExit)
    }

    public let directory: String
    public private(set) var state: State
    /// What the shell last set as its title, if anything.
    public private(set) var title: String?

    @ObservationIgnored let view: PicaTerminalView
    @ObservationIgnored private var exitHandlers: [@MainActor () -> Void] = []

    public init(launch: ShellLaunch) {
        directory = launch.directory
        view = PicaTerminalView(frame: CGRect(x: 0, y: 0, width: 640, height: 240))
        view.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        view.nativeForegroundColor = .textColor
        view.nativeBackgroundColor = .textBackgroundColor
        view.setAccessibilityIdentifier("pica.terminal.view")
        state = .ended(.failed)
        view.processDelegate = self
        view.startProcess(
            executable: launch.executable, args: [], environment: launch.environment, execName: launch.execName,
            currentDirectory: launch.directory)
        let pid = view.process.shellPid
        if view.process.running, pid > 0 {
            state = .running(pid: pid)
        }
    }

    public var pid: pid_t? {
        switch state {
        case .running(let pid), .ending(let pid): pid
        case .ended: nil
        }
    }

    public var isRunning: Bool {
        if case .running = state { true } else { false }
    }

    /// Ends the shell: SIGHUP now, SIGKILL after `grace` if it has not exited. The process is reaped when it exits,
    /// so the shell must be kept until then (`onExit`).
    public func end(grace: Duration) {
        guard case .running(let pid) = state else { return }
        state = .ending(pid: pid)
        kill(pid, SIGHUP)
        Task { [weak self] in
            try? await Task.sleep(for: grace)
            guard let self, case .ending(let pid) = self.state else { return }
            kill(pid, SIGKILL)
        }
    }

    /// Runs `handler` once the shell has exited, at once if it already has.
    public func onExit(_ handler: @escaping @MainActor () -> Void) {
        if case .ended = state {
            handler()
        } else {
            exitHandlers.append(handler)
        }
    }

    /// Types `text` into the shell, as the keyboard would.
    func send(_ text: String) {
        view.send(txt: text)
    }

    var screenText: String { view.screenText }

    private func exited(_ exit: ShellExit) {
        state = .ended(exit)
        let handlers = exitHandlers
        exitHandlers = []
        for handler in handlers {
            handler()
        }
    }
}

// SwiftTerm calls these on the main queue, where its process reads and is reaped.
extension TerminalShell: @preconcurrency LocalProcessTerminalViewDelegate {
    public func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}

    public func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
        self.title = title.isEmpty ? nil : title
    }

    public func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}

    public func processTerminated(source: TerminalView, exitCode: Int32?) {
        exited(ShellExit(waitStatus: exitCode))
    }
}
