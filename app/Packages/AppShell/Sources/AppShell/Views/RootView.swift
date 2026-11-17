import DesignSystem
import PicaProtocol
import SwiftUI

/// The main window's content: the navigation shell (A-04), with the engine's status over it (A-01).
public struct RootView: View {
    private let model: AppModel
    private let navigation: NavigationStore
    private let sessionContent: SessionContent
    private let inspectorPanes: [InspectorPane]
    private let onInteractive: @MainActor () -> Void

    /// `sessionContent` draws a selected session; the app target supplies the timeline, a feature of its own. It
    /// supplies the inspector's panes the same way.
    public init(
        model: AppModel, navigation: NavigationStore, sessionContent: @escaping SessionContent = SessionColumn.placeholder,
        inspectorPanes: [InspectorPane] = [], onInteractive: @escaping @MainActor () -> Void = {}
    ) {
        self.model = model
        self.navigation = navigation
        self.sessionContent = sessionContent
        self.inspectorPanes = inspectorPanes
        self.onInteractive = onInteractive
    }

    public var body: some View {
        let presentation = model.presentation
        // The split view does not expose an identifier of its own, so a container carries the root's.
        ZStack {
            NavigationShell(store: navigation, sessionContent: sessionContent, inspectorPanes: inspectorPanes) {
                if presentation.style == .banner {
                    EngineStatusBanner(presentation: presentation)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .disabled(presentation.style == .blocking)
        .overlay {
            if presentation.style == .blocking {
                EngineProblemPanel(presentation: presentation, retry: model.retry)
            }
        }
        .frame(minWidth: 720, minHeight: 420)
        .background(Palette.background)
        .accessibilityIdentifier("pica.root")
        .onAppear {
            // The window is on screen; the next turn of the main run loop is the first one that can handle input.
            DispatchQueue.main.async { onInteractive() }
        }
    }
}

struct EngineStatusBanner: View {
    let presentation: EngineStatusPresentation

    var body: some View {
        HStack(spacing: Spacing.small) {
            ProgressView().controlSize(.small)
            Text(presentation.title)
                .font(Typography.headline)
                .foregroundStyle(Palette.textPrimary)
            if !presentation.message.isEmpty {
                Text(presentation.message)
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            }
            Spacer()
        }
        .padding(.horizontal, Spacing.large)
        .padding(.vertical, Spacing.small)
        .background(Palette.surface)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("pica.engineStatus")
    }
}

struct EngineProblemPanel: View {
    let presentation: EngineStatusPresentation
    let retry: () -> Void

    var body: some View {
        ZStack {
            Rectangle().fill(Palette.background).opacity(0.92)
            Card {
                VStack(alignment: .leading, spacing: Spacing.medium) {
                    Text(presentation.title)
                        .font(Typography.title)
                        .foregroundStyle(Palette.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Text(presentation.message)
                        .font(Typography.body)
                        .foregroundStyle(Palette.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                    if let code = presentation.code {
                        Text(code)
                            .font(Typography.code)
                            .foregroundStyle(Palette.textSecondary)
                    }
                    HStack(spacing: Spacing.small) {
                        Spacer()
                        Button("Quit Pica") { NSApplication.shared.terminate(nil) }
                            .buttonStyle(.pica(.secondary))
                        if presentation.offersRetry {
                            Button("Try Again", action: retry)
                                .buttonStyle(.pica(.primary))
                                .keyboardShortcut(.defaultAction)
                        }
                    }
                }
                .frame(maxWidth: 460)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.engineProblem")
    }
}
