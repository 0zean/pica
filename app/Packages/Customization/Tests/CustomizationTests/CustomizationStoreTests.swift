@testable import Customization
import EngineClient
import PicaProtocol
import Testing

/// X-02: the window shows which layer each item comes from and which one wins, and leaves locked files read-only.
@MainActor
struct CustomizationStoreTests {
    private static let pica = "/atlas/.pica/agents/reviewer.md"

    private func store(_ items: [CustomizationItem], locations: [CustomizationLocation]) async -> (CustomizationStore, FakeCustomizationBackend) {
        let backend = FakeCustomizationBackend()
        backend.state.withLock { $0.listing = CustomizationListResult(items: items, locations: locations) }
        let store = CustomizationStore(backend: backend)
        store.repoNames = ["r1": "atlas"]
        await store.load(kind: .agent, scope: .repo(workspaceId: "w1", repoId: "r1"))
        return (store, backend)
    }

    private let locations = [
        location("builtin", layer: .builtin, label: "Built-in agents", writable: false),
        location("user", layer: .user, label: "Your agents"),
        location("workspace", layer: .workspace, label: "Workspace agents"),
        location("repo:r1:github-agents", layer: .repo, label: ".github/agents", repoId: "r1"),
        location("repo:r1:pica-agents", layer: .repo, label: ".pica/agents", repoId: "r1"),
    ]

    @Test func eachRowNamesItsLayerAndTheWinner() async {
        let (store, _) = await store(
            [
                item("bulk-reader", locationId: "builtin", layer: .builtin, path: "/builtin/bulk-reader.md", writable: false),
                item("reviewer", locationId: "repo:r1:pica-agents", layer: .repo, path: Self.pica, repoId: "r1"),
                item("reviewer", locationId: "repo:r1:github-agents", layer: .repo, path: "/atlas/.github/agents/reviewer.agent.md",
                     status: .overridden, overriddenBy: Self.pica, repoId: "r1"),
                item("reviewer", locationId: "workspace", layer: .workspace, path: "/w/reviewer.md", status: .overridden,
                     overriddenBy: Self.pica),
                item("reviewer", locationId: "user", layer: .user, path: "/u/reviewer.md", status: .overridden, overriddenBy: Self.pica),
                item("broken", locationId: "user", layer: .user, path: "/u/broken.md", status: .invalid,
                     problems: [CustomizationProblem(field: "tier", message: "unknown tier")]),
            ],
            locations: locations)

        let shown = store.items.map { store.presentation(of: $0) }.map { [$0.source, $0.status] }
        #expect(shown == [
            ["Built-in", "Active"],
            ["atlas · .pica/agents", "Wins"],
            ["atlas · .github/agents", "Overridden by atlas · .pica/agents"],
            ["Workspace", "Overridden by atlas · .pica/agents"],
            ["You", "Overridden by atlas · .pica/agents"],
            ["You", "Invalid: tier: unknown tier"],
        ])
        #expect(store.newItemLocations.map(\.id) == ["repo:r1:pica-agents", "repo:r1:github-agents", "workspace", "user"])
        #expect(store.selectedPath == "/builtin/bulk-reader.md")
        #expect(!store.isEditable(store.items[0]))
    }

    @Test func instructionsAllApply() async {
        let backend = FakeCustomizationBackend()
        backend.state.withLock {
            $0.listing = CustomizationListResult(
                items: [item("AGENTS.md", locationId: "repo:r1:agents-md", layer: .repo, path: "/atlas/AGENTS.md", kind: .instructions, repoId: "r1")],
                locations: [location("repo:r1:agents-md", layer: .repo, label: "AGENTS.md", repoId: "r1", singleFile: true, kind: .instructions)])
        }
        let store = CustomizationStore(backend: backend)
        store.repoNames = ["r1": "atlas"]
        await store.load(kind: .instructions, scope: .repo(workspaceId: "w1", repoId: "r1"))
        #expect(store.presentation(of: store.items[0]).status == "Applies")
        #expect(store.presentation(of: store.items[0]).source == "atlas · AGENTS.md")
    }

    @Test func aLockedFileIsReadOnlyAndNamesThePolicy() async {
        let (store, _) = await store(
            [item("helper", locationId: "user", layer: .user, path: "/u/helper.md", lockedBy: "acme")],
            locations: [location("user", layer: .user, label: "Your agents", lockedBy: "acme")])
        let helper = store.items[0]
        #expect(!store.isEditable(helper))
        #expect(store.presentation(of: helper).lock == "Locked by managed policy “acme”")
    }

    @Test func creatingSendsTheDraftAndKeepsTheEnginesRefusal() async {
        let (store, backend) = await store([], locations: locations)
        var draft = NewItemDraft(kind: .agent, locationId: "user")
        draft.name = " helper "
        draft.description = "Helps"
        draft.body = "Help."
        #expect(await store.create(draft))
        #expect(backend.calls == ["create user helper\n\(draft.text)"])
        #expect(store.selectedPath == "/new/helper.md")

        backend.state.withLock { $0.createFailure = RpcError(code: -32000, message: "tier: unknown tier \"genius\"") }
        #expect(!(await store.create(draft)))
        #expect(store.message == "tier: unknown tier \"genius\"")
    }
}
