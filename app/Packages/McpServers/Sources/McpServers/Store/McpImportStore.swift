import Foundation
import Observation
import PicaProtocol

/// Bringing in servers the user already runs elsewhere (M-07): candidates found in other agent platforms' files, or
/// a pasted `mcpServers` snippet. Nothing is imported until the user chooses, and nothing imported is attached.
@MainActor
@Observable
public final class McpImportStore {
    public enum Mode: Hashable, Sendable {
        case platforms
        case paste
    }

    public var mode: Mode
    public private(set) var sources: [McpImportSource] = []
    public var chosen: Set<String> = []
    public var snippet = ""
    /// Needed when the snippet is one entry without its name.
    public var snippetName = ""
    public var scope: McpScope
    public private(set) var message: String?
    /// The import's own notes: fields dropped and secrets moved to the Keychain.
    public private(set) var notes: [McpImportNote] = []
    public private(set) var isWorking = false

    @ObservationIgnored private let backend: any McpBackend
    @ObservationIgnored private let workspaceId: Id?

    public init(backend: any McpBackend, mode: Mode, workspaceId: Id?) {
        self.backend = backend
        self.mode = mode
        self.workspaceId = workspaceId
        scope = workspaceId == nil ? .global : .workspace
    }

    /// Candidates that can be imported.
    public var candidates: [McpImportCandidate] {
        sources.flatMap(\.candidates).filter { $0.issues.isEmpty }
    }

    public func loadPlatforms() async {
        await work {
            sources = try await backend.importCandidates(snippet: nil)
        }
    }

    /// Reads the snippet so its servers can be checked before they are imported.
    public func previewSnippet() async {
        guard let snippet = pastedSnippet else { return }
        await work {
            sources = try await backend.importCandidates(snippet: snippet)
            chosen = Set(candidates.map(\.candidateId))
        }
    }

    public var canImport: Bool {
        switch mode {
        case .platforms: !chosen.isEmpty
        case .paste: pastedSnippet != nil
        }
    }

    /// Returns whether the import succeeded.
    public func importChosen() async -> Bool {
        let scopeWorkspace = scope == .workspace ? workspaceId : nil
        return await work {
            let result: McpImportResult
            switch mode {
            case .platforms:
                let selections = chosen.sorted().map { McpImportSelection(candidateId: $0) }
                result = try await backend.importServers(scope: scope, workspaceId: scopeWorkspace, candidates: selections, snippet: nil)
            case .paste:
                result = try await backend.importServers(scope: scope, workspaceId: scopeWorkspace, candidates: nil, snippet: pastedSnippet)
            }
            notes = result.notes
        }
    }

    private var pastedSnippet: McpImportSnippet? {
        let text = snippet.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let name = snippetName.trimmingCharacters(in: .whitespaces)
        return McpImportSnippet(text: text, name: name.isEmpty ? nil : name)
    }

    @discardableResult
    private func work(_ body: () async throws -> Void) async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            try await body()
            message = nil
            return true
        } catch {
            message = McpErrorText.describe(error)
            return false
        }
    }
}
