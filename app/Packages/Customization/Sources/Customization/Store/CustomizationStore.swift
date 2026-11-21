import EngineClient
import Foundation
import Observation
import PicaProtocol

/// The Agents & Skills window (docs/agents.md): one kind's files from every layer of the chosen scope, which of them
/// wins, and editing, creating and deleting them through the engine.
@MainActor
@Observable
public final class CustomizationStore {
    public private(set) var kind: CustomizationKind = .agent
    public private(set) var scope: CustomizationScope = .user
    /// By name, then the winning location first, as the engine sorts them.
    public private(set) var items: [CustomizationItem] = []
    /// Lowest precedence first.
    public private(set) var locations: [CustomizationLocation] = []
    public var selectedPath: AbsolutePath?
    /// The last failure, shown above the list until the next action.
    public var message: String?
    public private(set) var isLoading = false
    /// Repo names by id, for the source of a repo's items.
    @ObservationIgnored public var repoNames: [Id: String] = [:]

    @ObservationIgnored private let backend: any CustomizationBackend

    public init(backend: any CustomizationBackend) {
        self.backend = backend
    }

    public var selected: CustomizationItem? {
        items.first { $0.path == selectedPath }
    }

    /// Where a new item can go: every writable location, highest precedence first.
    public var newItemLocations: [CustomizationLocation] {
        locations.filter(\.writable).reversed()
    }

    public func load(kind: CustomizationKind, scope: CustomizationScope) async {
        self.kind = kind
        self.scope = scope
        isLoading = true
        defer { isLoading = false }
        await report {
            let listed = try await backend.list(kind, scope: scope)
            items = listed.items
            locations = listed.locations
            if selected == nil { selectedPath = items.first?.path }
        }
    }

    /// Returns false when the engine refused the draft; `message` then says why.
    public func create(_ draft: NewItemDraft) async -> Bool {
        guard let locationId = draft.locationId else { return false }
        let singleFile = locations.first { $0.id == locationId }?.singleFile ?? false
        return await report {
            let item = try await backend.create(
                draft.kind, locationId: locationId, name: singleFile ? nil : draft.name.trimmed, text: draft.text,
                scope: scope)
            selectedPath = item.path
            await reload()
        }
    }

    @discardableResult
    public func save(_ item: CustomizationItem, text: String) async -> Bool {
        await report {
            _ = try await backend.save(item.kind, path: item.path, text: text, scope: scope)
            await reload()
        }
    }

    public func delete(_ item: CustomizationItem) async {
        await report {
            try await backend.delete(item.kind, path: item.path, scope: scope)
            selectedPath = nil
            await reload()
        }
    }

    /// Whether the item's file can be changed from Pica.
    public func isEditable(_ item: CustomizationItem) -> Bool {
        item.writable && item.lockedBy == nil
    }

    func repoName(_ repoId: Id) -> String? {
        repoNames[repoId]
    }

    private func reload() async {
        let listed = try? await backend.list(kind, scope: scope)
        if let listed {
            items = listed.items
            locations = listed.locations
        }
    }

    /// Runs `body`, keeping its failure as `message`. Returns whether it succeeded.
    @discardableResult
    private func report(_ body: () async throws -> Void) async -> Bool {
        do {
            try await body()
            message = nil
            return true
        } catch {
            if case .engine(let rpc) = error as? EngineClientError {
                message = rpc.message
            } else {
                message = error.localizedDescription
            }
            return false
        }
    }
}
