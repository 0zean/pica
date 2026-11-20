@testable import McpServers
import PicaProtocol
import Testing

/// A-13: a saved secret is never rendered back into a field. The editor is built from the server's definition, which
/// holds only references; no backend call reads a secret, and the field a secret is typed into starts empty.
@MainActor
struct SecretFieldTests {
    private let github = McpServerDef(
        id: "github", name: "GitHub",
        transport: .http(.init(
            type: .http, url: "https://api.githubcopilot.com/mcp/",
            headers: [
                "Authorization": .string("Bearer ${secret:keychain:github/github.com/pat}"),
                "X-Team": .string("platform"),
            ])),
        toolAllowlist: nil, scope: .global)

    private let local = McpServerDef(
        id: "docs", name: "Docs",
        transport: .stdio(.init(command: "docs-mcp", args: ["--stdio"], env: ["DOCS_TOKEN": .secretRef(SecretRef(secretRef: "keychain:mcp/docs/docs_token"))], cwd: nil)),
        toolAllowlist: ["search"], scope: .workspace)

    @Test func editingShowsASavedSecretAsSavedWithAnEmptyField() {
        let draft = ServerDraft(editing: github)
        let authorization = draft.fields.first { $0.name == "Authorization" }
        #expect(authorization?.value == .secret(prefix: "Bearer ", ref: "keychain:github/github.com/pat", entered: ""))
        #expect(authorization?.hasSavedSecret == true)
        #expect(draft.fields.first { $0.name == "X-Team" }?.value == .plain("platform"))
        #expect(draft.enteredSecrets.isEmpty)
    }

    @Test func savingWithoutTypingKeepsTheReferenceAndStoresNothing() async {
        let backend = FakeMcpBackend()
        backend.state.withLock { $0.servers = [github, local] }
        let store = McpServersStore(backend: backend)
        await store.load(workspaceId: nil)
        for server in [github, local] {
            #expect(ServerDraft(editing: server).definition == server)
            #expect(await store.save(ServerDraft(editing: server)))
        }
        #expect(backend.calls == ["update github", "update docs"])
    }

    @Test func typingAReplacementStoresItUnderTheSameReference() async {
        let backend = FakeMcpBackend()
        let store = McpServersStore(backend: backend)
        var draft = ServerDraft(editing: local)
        draft.fields[0].value = .secret(prefix: "", ref: "keychain:mcp/docs/docs_token", entered: "new-token")
        #expect(await store.save(draft))
        #expect(backend.state.withLock { $0.storedSecrets } == ["keychain:mcp/docs/docs_token": "new-token"])
        #expect(backend.calls == ["storeSecret keychain:mcp/docs/docs_token", "update docs", "restart docs"])
        #expect(draft.definition == local)
    }

    @Test func anEnvironmentReferenceStaysTextAndDuplicateNamesAreRefused() {
        let server = McpServerDef(
            id: "ci", name: "CI",
            transport: .stdio(.init(command: "ci-mcp", args: [], env: ["CI_TOKEN": .secretRef(SecretRef(secretRef: "env:CI_TOKEN"))], cwd: nil)),
            toolAllowlist: nil, scope: .global)
        var draft = ServerDraft(editing: server)
        #expect(draft.fields[0].value == .plain("${secret:env:CI_TOKEN}"))
        #expect(draft.fields[0].hasSavedSecret == false)
        guard case .stdio(let stdio) = draft.definition.transport else { Issue.record("not local"); return }
        #expect(stdio.env == ["CI_TOKEN": .string("${secret:env:CI_TOKEN}")])
        draft.fields.append(DraftField(name: "CI_TOKEN", value: .plain("x")))
        #expect(draft.problem == "Two headers or variables have the same name.")
        _ = draft.definition
    }

    @Test func aNewSecretGetsAReferenceUnderTheServer() {
        var draft = ServerDraft(scope: .global)
        draft.id = "tracker"
        draft.name = "Tracker"
        draft.url = "https://tracker.example.com/mcp"
        draft.fields = [DraftField(name: "Api-Key", value: .secret(prefix: "", ref: nil, entered: "k-123"))]
        #expect(draft.problem == nil)
        #expect(draft.enteredSecrets.map(\.ref) == ["keychain:mcp/tracker/api-key"])
        guard case .http(let http) = draft.definition.transport else { Issue.record("not remote"); return }
        #expect(http.headers == ["Api-Key": .secretRef(SecretRef(secretRef: "keychain:mcp/tracker/api-key"))])
    }

    @Test func aPresetSecretIsStoredAndRenderedAsItsReferenceOnly() async {
        let backend = FakeMcpBackend()
        let store = McpServersStore(backend: backend)
        let preset = McpPreset(id: "github", name: "GitHub", description: "", parameters: [
            McpPresetParameter(name: "auth", label: "Sign-in", description: "", kind: .choice, required: true, default: "copilot", choices: ["copilot", "pat"], examples: [], onlyWhen: nil),
            McpPresetParameter(name: "patSecretRef", label: "Personal access token", description: "", kind: .secretRef, required: true, default: "keychain:github/github.com/pat", choices: nil, examples: [], onlyWhen: .init(parameter: "auth", values: ["pat"])),
        ])
        var form = PresetForm(preset: preset, scope: .global)
        #expect(form.visibleParameters.map(\.name) == ["auth"])
        form.values["auth"] = "pat"
        #expect(form.problem == "Enter the personal access token.")
        form.secrets["patSecretRef"] = "ghp-secret"
        #expect(await store.addPreset(form))
        #expect(backend.state.withLock { $0.rendered } == ["auth": "pat", "patSecretRef": "keychain:github/github.com/pat"])
        #expect(backend.calls == ["storeSecret keychain:github/github.com/pat", "renderPreset github", "add github"])
    }
}
