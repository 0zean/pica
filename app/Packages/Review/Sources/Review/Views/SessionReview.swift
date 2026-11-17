import DesignSystem
import EngineClient
import PicaProtocol
import SwiftUI

/// The review of a session's changes (A-08): the changed files on the left, the selected diff on the right, and the
/// commit bar under it. The app target shows it in the session column in place of the conversation.
public struct SessionReview: View {
    @State private var store: ReviewStore
    @State private var pendingDiscard: ChangeTarget?
    @Environment(ReviewMetrics.self) private var metrics: ReviewMetrics?
    private let sessionState: SessionState

    public init(session: Session, client: EngineClient) {
        self.init(store: ReviewStore(session: session, backend: EngineReviewBackend(client: client)), state: session.state)
    }

    init(store: ReviewStore, state: SessionState) {
        _store = State(initialValue: store)
        sessionState = state
    }

    public var body: some View {
        HSplitView {
            ChangeList(store: store, actions: actions)
                .frame(minWidth: 200, idealWidth: 260, maxWidth: 420)
            VStack(spacing: 0) {
                diff
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                CommitBar(store: store)
            }
            .frame(minWidth: 360)
        }
        .background(Palette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.review")
        .task { await store.load() }
        // The agent may have changed files during its turn; look again when it finishes.
        .onChange(of: sessionState) { Task { await store.refresh() } }
        .confirmationDialog(
            "Discard these changes?", isPresented: Binding(get: { pendingDiscard != nil }, set: { if !$0 { pendingDiscard = nil } })
        ) {
            Button("Discard", role: .destructive) {
                if let target = pendingDiscard { Task { await store.discard(target) } }
                pendingDiscard = nil
            }
            .accessibilityIdentifier("pica.review.confirmDiscard")
        } message: {
            Text("The working copy goes back to the staged version. This cannot be undone.")
        }
        .toolbar {
            ToolbarItem {
                Button { Task { await store.refresh() } } label: { Label("Refresh Changes", systemImage: "arrow.clockwise") }
                    .keyboardShortcut("r", modifiers: .command)
                    .help("Refresh Changes (⌘R)")
                    .accessibilityIdentifier("pica.review.refresh")
            }
        }
    }

    @ViewBuilder private var diff: some View {
        if let document = store.document, let file = store.selectedFile {
            DiffPane(document: document, file: file, layout: $store.layout, actions: actions) {
                metrics?.diffAppeared(
                    path: file.path, lines: document.lineCount, layout: store.layout, selectedAt: store.selectedAt)
            }
            .id(file.id)
        } else if !store.loaded {
            ProgressView()
        } else if store.repos.isEmpty {
            EmptyState("No repos to review", message: "This session writes no repo Pica can read changes from.")
        } else {
            EmptyState("No changes", message: "The working tree matches the last commit.")
                .accessibilityIdentifier("pica.review.clean")
        }
    }

    private var actions: ReviewActions {
        ReviewActions(
            stage: { target in Task { await store.stage(target) } },
            unstage: { target in Task { await store.unstage(target) } },
            discard: { target in pendingDiscard = target })
    }
}
