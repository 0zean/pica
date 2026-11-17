import Observation

/// Runs actions. The app target gives it one closure that switches over every `ActionID`.
@MainActor
public final class ActionRegistry {
    public let definitions: [ActionDefinition]
    private let handler: @MainActor (ActionID) -> Void

    public init(definitions: [ActionDefinition] = ActionCatalog.all, perform handler: @escaping @MainActor (ActionID) -> Void) {
        self.definitions = definitions
        self.handler = handler
    }

    public func perform(_ id: ActionID) {
        handler(id)
    }
}
