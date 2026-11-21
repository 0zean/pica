@testable import Customization
import EngineClient
import Foundation
import PicaProtocol
import Synchronization

final class FakeCustomizationBackend: CustomizationBackend {
    struct State {
        var listing = CustomizationListResult(items: [], locations: [])
        var calls: [String] = []
        var createFailure: RpcError?
    }

    let state = Mutex(State())
    var calls: [String] { state.withLock { $0.calls } }

    func list(_ kind: CustomizationKind, scope: CustomizationScope) async throws -> CustomizationListResult {
        state.withLock { $0.listing }
    }

    func create(_ kind: CustomizationKind, locationId: Id, name: String?, text: String, scope: CustomizationScope)
        async throws -> CustomizationItem
    {
        let failure = state.withLock { state in
            state.calls.append("create \(locationId) \(name ?? "-")\n\(text)")
            return state.createFailure
        }
        if let failure { throw EngineClientError.engine(failure) }
        return item(name ?? "file", locationId: locationId, layer: .user, path: "/new/\(name ?? "file").md")
    }

    func save(_ kind: CustomizationKind, path: AbsolutePath, text: String, scope: CustomizationScope) async throws
        -> CustomizationItem
    {
        state.withLock { $0.calls.append("save \(path)") }
        return item("saved", locationId: "user", layer: .user, path: path)
    }

    func delete(_ kind: CustomizationKind, path: AbsolutePath, scope: CustomizationScope) async throws {
        state.withLock { $0.calls.append("delete \(path)") }
    }
}

func item(
    _ name: String, locationId: Id, layer: CustomizationLayer, path: AbsolutePath, kind: CustomizationKind = .agent,
    status: CustomizationStatus = .active, overriddenBy: AbsolutePath? = nil, repoId: Id? = nil, writable: Bool = true,
    problems: [CustomizationProblem] = [], lockedBy: String? = nil
) -> CustomizationItem {
    CustomizationItem(
        kind: kind, name: name, locationId: locationId, layer: layer, repoId: repoId, path: path, description: nil,
        text: "text", status: status, overriddenBy: overriddenBy, problems: problems, writable: writable, lockedBy: lockedBy)
}

func location(
    _ id: Id, layer: CustomizationLayer, label: String, repoId: Id? = nil, writable: Bool = true, singleFile: Bool = false,
    lockedBy: String? = nil, kind: CustomizationKind = .agent
) -> CustomizationLocation {
    CustomizationLocation(
        id: id, kind: kind, layer: layer, label: label, repoId: repoId, path: "/\(id)", singleFile: singleFile,
        writable: writable, lockedBy: lockedBy)
}
