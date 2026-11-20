import DesignSystem
import EngineClient
import PicaProtocol
import SwiftUI

/// The Usage dashboard window: filters in the toolbar over `UsageDashboardView` (docs/usage.md).
public struct UsageDashboardScreen: View {
    public static let windowId = "usage"

    @State private var store: UsageDashboardStore
    @Environment(\.controlActiveState) private var activeState

    public init(client: EngineClient) {
        _store = State(initialValue: UsageDashboardStore(backend: EngineUsageBackend(client: client)))
    }

    init(store: UsageDashboardStore) {
        _store = State(initialValue: store)
    }

    public var body: some View {
        @Bindable var store = store
        content
            .frame(minWidth: 720, minHeight: 520)
            .background(Palette.background)
            .toolbar {
                ToolbarItemGroup(placement: .principal) {
                    Picker("Period", selection: $store.period) {
                        ForEach(UsagePeriod.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("pica.usage.period")
                    Picker("Workspace", selection: $store.workspaceId) {
                        Text("All Workspaces").tag(Id?.none)
                        ForEach(store.workspaces, id: \.id) { Text($0.name).tag(Id?.some($0.id)) }
                    }
                    .accessibilityIdentifier("pica.usage.workspace")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await store.load() } }
                        .keyboardShortcut("r")
                        .help("Refresh (⌘R)")
                        .accessibilityIdentifier("pica.usage.refresh")
                }
            }
            .task(id: Filters(period: store.period, workspaceId: store.workspaceId)) { await store.load() }
            .onChange(of: activeState) { _, state in
                if state == .key { Task { await store.load() } }
            }
            .navigationTitle("Usage")
    }

    @ViewBuilder private var content: some View {
        if let failure = store.failure {
            EmptyState("Usage is unavailable", message: failure) {
                Button("Try Again") { Task { await store.load() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let dashboard = store.dashboard {
            ScrollView {
                UsageDashboardView(dashboard: dashboard)
            }
        } else {
            ProgressView("Loading usage…")
                .controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private struct Filters: Equatable {
        let period: UsagePeriod
        let workspaceId: Id?
    }
}
