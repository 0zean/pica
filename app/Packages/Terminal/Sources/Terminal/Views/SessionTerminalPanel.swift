import DesignSystem
import PicaProtocol
import SwiftUI

/// The terminal panel under a session's conversation or review: which directory the shell is in, the shell, and a
/// button that closes the panel, which ends the shell.
public struct SessionTerminalPanel: View {
    let terminal: SessionTerminal
    let close: () -> Void

    public init(terminal: SessionTerminal, close: @escaping () -> Void) {
        self.terminal = terminal
        self.close = close
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .background(Palette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.terminal")
        .task(id: terminal.sessionId) {
            await terminal.load()
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.small) {
            Image(systemName: "terminal")
                .foregroundStyle(Palette.textSecondary)
                .accessibilityHidden(true)
            directory
            if let shell = terminal.shell, case .ended(let exit) = shell.state {
                Text(exit.summary)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityIdentifier("pica.terminal.ended")
                Button("New Shell") { terminal.restart() }
                    .controlSize(.small)
                    .accessibilityIdentifier("pica.terminal.restart")
            }
            Spacer(minLength: 0)
            Button(action: close) {
                Image(systemName: "xmark")
            }
            .buttonStyle(.borderless)
            .help("Close the Terminal, ending its shell")
            .accessibilityLabel("Close Terminal")
            .accessibilityIdentifier("pica.terminal.close")
        }
        .padding(.horizontal, Spacing.medium)
        .padding(.vertical, Spacing.xSmall)
    }

    @ViewBuilder
    private var directory: some View {
        let current = terminal.shell?.directory ?? terminal.roots.first?.path
        if terminal.roots.count > 1 {
            Picker("Directory", selection: Binding(get: { current ?? "" }, set: { terminal.start(in: $0) })) {
                ForEach(terminal.roots, id: \.path) { root in
                    Text(Self.name(of: root)).tag(root.path)
                }
            }
            .labelsHidden()
            .fixedSize()
            .help(current ?? "")
            .accessibilityValue(current ?? "")
            .accessibilityIdentifier("pica.terminal.directory")
        } else if let current {
            Text(URL(filePath: current).lastPathComponent)
                .font(Typography.callout)
                .foregroundStyle(Palette.textPrimary)
                .help(current)
                .accessibilityValue(current)
                .accessibilityIdentifier("pica.terminal.directory")
        }
    }

    @ViewBuilder
    private var content: some View {
        if let shell = terminal.shell {
            TerminalHost(shell: shell)
                .id(ObjectIdentifier(shell))
        } else if let failure = terminal.failure {
            EmptyState("No shell", message: failure)
        } else {
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private static func name(of root: SessionRoot) -> String {
        let name = URL(filePath: root.path).lastPathComponent
        return root.access == .reference ? "\(name) (reference)" : name
    }
}
