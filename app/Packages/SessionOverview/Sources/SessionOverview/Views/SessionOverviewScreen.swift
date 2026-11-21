import DesignSystem
import EngineClient
import PicaProtocol
import SwiftUI

/// The Session Overview window (A-16): a board of every session with the attention queue first, and the aggregate of
/// each fan-out run. The app target passes what its navigation store knows, and how to open a session in the main
/// window. Specified in docs/session-overview.md.
public struct SessionOverviewScreen: View {
    public static let windowId = "session-overview"

    public enum Tab: String, CaseIterable, Identifiable, Sendable {
        case board
        case fanOuts

        public var id: String { rawValue }

        var title: String {
            switch self {
            case .board: "Board"
            case .fanOuts: "Fan-outs"
            }
        }
    }

    private let sessions: [Session]
    private let workspaces: [Workspace]
    private let repoNames: [Id: String]
    private let open: (Id) -> Void
    private let metrics: OverviewMetrics?
    @State private var fanOuts: FanOutStore
    @State private var tab = Tab.board
    @State private var workspaceId: Id?

    public init(
        sessions: [Session], workspaces: [Workspace], repoNames: [Id: String], client: EngineClient,
        metrics: OverviewMetrics? = nil, open: @escaping (Id) -> Void
    ) {
        self.init(
            sessions: sessions, workspaces: workspaces, repoNames: repoNames,
            fanOutBackend: EngineFanOutBackend(client: client), metrics: metrics, open: open)
    }

    public init(
        sessions: [Session], workspaces: [Workspace], repoNames: [Id: String], fanOutBackend: any FanOutBackend,
        metrics: OverviewMetrics? = nil, open: @escaping (Id) -> Void
    ) {
        self.sessions = sessions
        self.workspaces = workspaces
        self.repoNames = repoNames
        self.metrics = metrics
        self.open = open
        _fanOuts = State(initialValue: FanOutStore(backend: fanOutBackend))
    }

    public var body: some View {
        let board = OverviewBoard(sessions: sessions, workspaceId: workspaceId)
        VStack(spacing: 0) {
            header
            Divider()
            switch tab {
            case .board:
                BoardView(board: board, workspaceNames: workspaceNames, open: open)
            case .fanOuts:
                FanOutListView(summaries: summaries, store: fanOuts, open: open)
            }
        }
        .background(Palette.background)
        .onAppear {
            fanOuts.start()
            metrics?.boardAppeared(total: board.total, queued: board.queue.count)
        }
        .onDisappear { fanOuts.stop() }
        .onChange(of: board) { metrics?.boardChanged(total: board.total, queued: board.queue.count) }
    }

    private var header: some View {
        HStack(spacing: Spacing.medium) {
            Picker("View", selection: $tab) {
                ForEach(Tab.allCases) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .accessibilityIdentifier("pica.overview.tab")
            Spacer()
            Picker("Workspace", selection: $workspaceId) {
                Text("All Workspaces").tag(Id?.none)
                ForEach(workspaces, id: \.id) { workspace in
                    Text(workspace.name).tag(Id?.some(workspace.id))
                }
            }
            .fixedSize()
            .accessibilityIdentifier("pica.overview.workspace")
        }
        .padding(.horizontal, Spacing.large)
        .padding(.vertical, Spacing.small)
    }

    private var workspaceNames: [Id: String] {
        Dictionary(workspaces.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    }

    private var summaries: [FanOutSummary] {
        let names = workspaceNames
        return fanOuts.fanOuts
            .filter { workspaceId == nil || $0.workspaceId == workspaceId }
            .map { fanOut in
                FanOutSummary(fanOut, workspaceName: names[fanOut.workspaceId] ?? "") { repoNames[$0] ?? $0 }
            }
    }
}
