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
public struct ComposerView: View {
    let store: ComposerStore
    @Environment(ComposerMetrics.self) private var metrics: ComposerMetrics?
    @State private var inputHeight = ComposerInput.height(forContent: ComposerInput.lineHeight)

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
        .overlay(alignment: .topLeading) {
            if let completion = store.completion {
                CompletionList(store: store, completion: completion)
                    .alignmentGuide(.top) { $0[.bottom] + Spacing.xSmall }
            }
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
                .help(store.primaryMode == .queue ? "Run this message after the current turn (⌘↩)" : "Send (⌘↩)")
                .accessibilityIdentifier("pica.composer.send")
        }
        .controlSize(.small)
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
        case .failed(let message): message
        }
    }
}
