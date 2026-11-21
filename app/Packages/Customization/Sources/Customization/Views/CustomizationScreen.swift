import DesignSystem
import PicaProtocol
import SwiftUI

/// The Agents & Skills window (docs/agents.md): custom agents, skills and instruction files from every layer of the
/// chosen scope, which one wins, and editing them. Every write goes through the engine, which validates it first.
public struct CustomizationScreen: View {
    public static let windowId = "customization"

    @State private var store: CustomizationStore
    @State private var kind: CustomizationKind = .agent
    @State private var scope: CustomizationScope
    @State private var draft: NewItemDraft?
    private let workspaces: [Workspace]
    private let repos: [Id: [Repo]]

    public init(backend: any CustomizationBackend, workspaces: [Workspace], repos: [Id: [Repo]], workspaceId: Id? = nil) {
        self.workspaces = workspaces
        self.repos = repos
        _store = State(initialValue: CustomizationStore(backend: backend))
        _scope = State(initialValue: workspaceId.map(CustomizationScope.workspace) ?? .user)
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if let message = store.message, draft == nil {
                MessageBar(text: message) { store.message = nil }
            }
            HSplitView {
                ItemList(store: store)
                    .frame(minWidth: 280, idealWidth: 340)
                detail
                    .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 760, minHeight: 460)
        .background(Palette.background)
        .onChange(of: repos, initial: true) {
            store.repoNames = Dictionary(repos.values.joined().map { ($0.id, RepoName.of($0)) }, uniquingKeysWith: { first, _ in first })
        }
        .task(id: Reload(kind: kind, scope: scope)) { await store.load(kind: kind, scope: scope) }
        .sheet(item: $draft) { draft in
            NewItemSheet(draft: draft, store: store) { self.draft = nil }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.customization")
    }

    private struct Reload: Hashable {
        let kind: CustomizationKind
        let scope: CustomizationScope
    }

    private var header: some View {
        HStack(spacing: Spacing.medium) {
            Picker("Kind", selection: $kind) {
                ForEach(CustomizationKind.allCases, id: \.self) { Text($0.pluralTitle).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: 320)
            .accessibilityIdentifier("pica.customization.kind")
            Picker("Show", selection: $scope) {
                Text("Your files").tag(CustomizationScope.user)
                ForEach(workspaces, id: \.id) { workspace in
                    Section(workspace.name) {
                        Text(workspace.name).tag(CustomizationScope.workspace(workspace.id))
                        ForEach(repos[workspace.id] ?? [], id: \.id) { repo in
                            Text("\(workspace.name) › \(RepoName.of(repo))")
                                .tag(CustomizationScope.repo(workspaceId: workspace.id, repoId: repo.id))
                        }
                    }
                }
            }
            .frame(maxWidth: 300)
            .accessibilityIdentifier("pica.customization.scope")
            Spacer()
            Button {
                draft = NewItemDraft(kind: kind, locationId: store.newItemLocations.first { $0.lockedBy == nil }?.id)
            } label: {
                Label("New \(kind.title)", systemImage: "plus")
            }
            .disabled(store.newItemLocations.allSatisfy { $0.lockedBy != nil })
            .help(store.newItemLocations.first?.lockedBy.map { "Locked by managed policy “\($0)”" } ?? "")
            .accessibilityIdentifier("pica.customization.new")
        }
        .padding(Spacing.medium)
    }

    @ViewBuilder private var detail: some View {
        if let item = store.selected {
            ItemDetail(item: item, store: store).id("\(item.path)\n\(item.text)")
        } else {
            EmptyState("No \(kind.pluralTitle.lowercased())", message: kind.emptyMessage)
        }
    }
}

extension NewItemDraft: Identifiable {
    public var id: String { kind.rawValue }
}

extension CustomizationKind {
    var title: String {
        switch self {
        case .agent: "Agent"
        case .skill: "Skill"
        case .instructions: "Instructions"
        }
    }

    var pluralTitle: String {
        switch self {
        case .agent: "Agents"
        case .skill: "Skills"
        case .instructions: "Instructions"
        }
    }

    var emptyMessage: String {
        switch self {
        case .agent: "Agents are Markdown files with a description, a tier and their tools. Create one with New Agent."
        case .skill: "A skill is a folder with a SKILL.md the agent reads when the task calls for it."
        case .instructions: "AGENTS.md, .github/copilot-instructions.md and your own instructions apply to every session."
        }
    }
}

/// A repo's name as the sidebar shows it: its checkout's folder, else its URL's last part without `.git`.
enum RepoName {
    static func of(_ repo: Repo) -> String {
        let source = repo.localPath ?? repo.remoteUrl ?? repo.id
        let last = source.split(separator: "/").last.map(String.init) ?? source
        return last.hasSuffix(".git") ? String(last.dropLast(4)) : last
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
        .accessibilityIdentifier("pica.customization.message")
    }
}
