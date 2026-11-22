import DesignSystem
import EngineClient
import PicaProtocol
import SwiftUI

/// The MCP Servers window (docs/mcp.md): every server defined globally or in the chosen workspace, with its health
/// and token cost; adding from a preset, by hand, from a pasted snippet or from other apps; editing, signing in,
/// rechecking and removing; and which servers the workspace gives each new session.
public struct McpServersScreen: View {
    public static let windowId = "mcp"

    @State private var store: McpServersStore
    @State private var workspaceId: Id?
    @State private var sheet: Sheet?
    @State private var removing: McpServerDef?
    private let backend: any McpBackend
    private let workspaces: [Workspace]

    enum Sheet: Identifiable {
        case preset(PresetForm)
        case editor(ServerDraft)
        case importing(McpImportStore.Mode)

        var id: String {
            switch self {
            case .preset(let form): "preset.\(form.preset.id)"
            case .editor(let draft): "editor.\(draft.id)"
            case .importing(let mode): "import.\(mode)"
            }
        }
    }

    public init(backend: any McpBackend, workspaces: [Workspace], workspaceId: Id? = nil) {
        self.backend = backend
        self.workspaces = workspaces
        _store = State(initialValue: McpServersStore(backend: backend))
        _workspaceId = State(initialValue: workspaceId)
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if let message = store.message {
                MessageBar(text: message) { store.message = nil }
            }
            if store.servers.isEmpty && !store.isLoading {
                EmptyState(
                    "No MCP servers",
                    message: "Pica works without any. Add one from a preset, by hand, or from the apps you already use."
                ) { addMenu }
            } else {
                serverList
            }
        }
        .frame(minWidth: Column.minimumRowWidth, minHeight: 420)
        .background(Palette.background)
        .task(id: workspaceId) { await store.load(workspaceId: workspaceId) }
        .task { await store.watchStatuses() }
        .sheet(item: $sheet) { sheet in sheetContent(sheet) }
        .confirmationDialog(
            "Remove \(removing?.name ?? "")?", isPresented: removingBinding, presenting: removing
        ) { server in
            Button("Remove", role: .destructive) { Task { await store.remove(server) } }
        } message: { _ in
            Text("It is taken out of its mcp.jsonc and detached from every workspace and session. Sessions already running keep it until they are reopened.")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.mcp")
    }

    private var header: some View {
        HStack(spacing: Spacing.medium) {
            Picker("Show", selection: $workspaceId) {
                Text("Global servers").tag(Id?.none)
                ForEach(workspaces, id: \.id) { workspace in
                    Text(workspace.name).tag(Id?.some(workspace.id))
                }
            }
            .frame(maxWidth: 280)
            .accessibilityIdentifier("pica.mcp.workspace")
            Spacer()
            addMenu
        }
        .padding(Spacing.medium)
    }

    private var addMenu: some View {
        Menu {
            Section("Presets") {
                ForEach(store.presets, id: \.id) { preset in
                    Button(preset.name) { sheet = .preset(PresetForm(preset: preset, scope: store.newServerScope)) }
                        .accessibilityIdentifier("pica.mcp.add.preset.\(preset.id)")
                }
            }
            Divider()
            Button("Custom Server…") { sheet = .editor(ServerDraft(scope: store.newServerScope)) }
                .accessibilityIdentifier("pica.mcp.add.custom")
            Button("Paste a Server Snippet…") { sheet = .importing(.paste) }
                .accessibilityIdentifier("pica.mcp.add.paste")
            Button("Import from Other Apps…") { sheet = .importing(.platforms) }
                .accessibilityIdentifier("pica.mcp.add.import")
        } label: {
            Label("Add Server", systemImage: "plus")
        }
        .fixedSize()
        .accessibilityIdentifier("pica.mcp.add")
    }

    private var serverList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ServerRowHeader(showsAttachment: workspaceId != nil)
                ForEach(store.servers, id: \.id) { server in
                    ServerRow(
                        server: server, status: store.statuses[server.id],
                        attached: workspaceId == nil ? nil : attachedBinding(server.id),
                        offersSignIn: store.offersSignIn(server),
                        edit: { sheet = .editor(ServerDraft(editing: server)) },
                        signIn: { Task { await store.signIn(server.id) } },
                        recheck: { Task { await store.restart(server.id) } },
                        remove: { removing = server })
                    Divider()
                }
            }
        }
    }

    @ViewBuilder private func sheetContent(_ sheet: Sheet) -> some View {
        switch sheet {
        case .preset(let form):
            PresetSheet(form: form, store: store) { self.sheet = nil }
        case .editor(let draft):
            ServerEditorSheet(draft: draft, store: store) { self.sheet = nil }
        case .importing(let mode):
            ImportSheet(store: McpImportStore(backend: backend, mode: mode, workspaceId: workspaceId)) {
                self.sheet = nil
                Task { await store.load(workspaceId: workspaceId) }
            }
        }
    }

    private func attachedBinding(_ serverId: Id) -> Binding<Bool> {
        Binding(
            get: { store.workspaceAttached.contains(serverId) },
            set: { attached in Task { await store.setAttached(serverId, attached) } })
    }

    private var removingBinding: Binding<Bool> {
        Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
    }
}

/// A failure the last action left, with a way to dismiss it.
struct MessageBar: View {
    let text: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.small) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Palette.warning).accessibilityHidden(true)
            Text(text).font(Typography.callout).foregroundStyle(Palette.textPrimary).textSelection(.enabled)
            Spacer()
            Button("Dismiss", action: dismiss).buttonStyle(.borderless)
        }
        .padding(Spacing.small)
        .background(Palette.surface)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("pica.mcp.message")
    }
}
