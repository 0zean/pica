import DesignSystem
import EngineClient
import PicaProtocol
import SwiftUI

/// The composer for a session, fed by the engine. The app target puts it under the session's timeline and passes the
/// session again whenever the engine reports a change, so the composer follows its state. Give it `.id(sessionId)`.
public struct SessionComposer: View {
    @State private var store: ComposerStore
    private let session: Session

    public init(session: Session, client: EngineClient, drafts: ComposerDrafts? = nil) {
        self.session = session
        _store = State(initialValue: ComposerStore(session: session, backend: EngineComposerBackend(client: client), drafts: drafts))
    }

    public var body: some View {
        ComposerView(store: store)
            .task { await store.load() }
            .onChange(of: session) { store.update(session: session) }
    }
}

/// The composer: completions above the input, the input, and a bar of pickers and send controls.
///
/// The completion list opens upward over whatever is above the composer, and is never taller than the space between
/// the composer and the top of `completionBounds`: a coordinate space the host declares around the composer and what
/// sits above it (the app target declares it on the session column). Without one, the list goes up to the window's
/// top.
public struct ComposerView: View {
    /// The space the completion list may grow into; see the type's documentation.
    public nonisolated static var completionBounds: NamedCoordinateSpace { .named("pica.composer.completionBounds") }
    /// Kept between the list and the top of `completionBounds`.
    static let completionMargin = Spacing.small

    let store: ComposerStore
    @Environment(ComposerMetrics.self) private var metrics: ComposerMetrics?
    @State private var inputHeight = ComposerInput.height(forContent: ComposerInput.lineHeight)
    /// From the top of `completionBounds` to the top of the composer's box.
    @State private var spaceAbove: CGFloat = 0

    public init(store: ComposerStore) {
        self.store = store
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            ComposerInput(store: store, metrics: metrics, catalogRevision: store.catalogRevision, height: $inputHeight)
                .frame(height: inputHeight)
            ComposerBar(store: store)
        }
        .padding(.horizontal, Spacing.medium)
        .padding(.vertical, Spacing.small)
        .background(RoundedRectangle(cornerRadius: Radius.large, style: .continuous).fill(Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: Radius.large, style: .continuous).stroke(Palette.border))
        .onGeometryChange(for: CGFloat.self, of: { $0.frame(in: Self.completionBounds).minY }) { spaceAbove = $0 }
        .probedFrame("box")
        // The guide must sit outside any `if`: SwiftUI ignores an alignment guide set inside a conditional overlay,
        // which left the list hanging down from the composer's top, past the window.
        .overlay(alignment: .topLeading) {
            CompletionPopup(store: store, maxHeight: spaceAbove - Spacing.xSmall - Self.completionMargin)
                .alignmentGuide(.top) { $0[.bottom] + Spacing.xSmall }
        }
        .padding(.horizontal, Spacing.large)
        .padding(.bottom, Spacing.medium)
        .padding(.top, Spacing.small)
        .background(Palette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.composer")
    }
}

/// The row under the input: profile and tier pickers, what happened to the last message, and the send controls.
struct ComposerBar: View {
    let store: ComposerStore

    var body: some View {
        HStack(spacing: Spacing.small) {
            ProfilePicker(store: store)
            TierPicker(store: store)
            if let status = store.status {
                StatusLine(status: status)
                    .layoutPriority(-1)
            }
            Spacer(minLength: 0)
            if store.needsResume {
                Button("Resume", systemImage: "play.fill") { Task { await store.resume() } }
                    .buttonStyle(.pica(.secondary))
                    .disabled(!store.canResume)
                    .help("Reopen the session so it can take a message. Sending also resumes it.")
                    .accessibilityIdentifier("pica.composer.resume")
            }
            if store.isRunning {
                Button("Stop", systemImage: "stop.fill") { Task { await store.stop() } }
                    .buttonStyle(.pica(.secondary))
                    .help("Stop the current turn (⌘.)")
                    .accessibilityIdentifier("pica.composer.stop")
                Button("Steer") { Task { await store.submit(.steer) } }
                    .buttonStyle(.pica(.secondary))
                    .disabled(!store.canSend)
                    .help("Stop the current turn and run this message next (⇧⌘↩)")
                    .accessibilityIdentifier("pica.composer.steer")
            }
            Button(store.primaryMode == .queue ? "Queue" : "Send") { Task { await store.submit() } }
                .buttonStyle(.pica(.primary))
                .disabled(!store.canSend)
                .help(sendHelp)
                .accessibilityIdentifier("pica.composer.send")
        }
        .controlSize(.small)
    }

    private var sendHelp: String {
        if store.primaryMode == .queue { return "Run this message after the current turn (↩)" }
        if store.needsResume { return "Resume the session and send (↩)" }
        return "Send (↩). ⇧↩ adds a line."
    }
}

struct StatusLine: View {
    let status: ComposerStore.Status

    var body: some View {
        Text(text)
            .font(Typography.caption)
            .foregroundStyle(isFailure ? Palette.danger : Palette.textSecondary)
            .lineLimit(1)
            .truncationMode(.tail)
            .accessibilityIdentifier("pica.composer.status")
    }

    private var isFailure: Bool {
        if case .failed = status { return true }
        return false
    }

    private var text: String {
        switch status {
        case .queued: "Queued. It runs after the current turn."
        case .steered: "Steering. The current turn stops and this runs next."
        case .resuming: "Resuming the session…"
        case .failed(let message): message
        }
    }
}
