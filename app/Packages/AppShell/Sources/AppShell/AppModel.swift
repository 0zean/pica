import EngineClient
import Observation

/// The app-wide store: the engine's status as the window shows it (EngineClient → store → view, PLAN.md §8).
@Observable @MainActor
public final class AppModel {
    public private(set) var engineStatus = EngineStatus.starting
    @ObservationIgnored public let supervisor: EngineSupervisor
    @ObservationIgnored private var following: Task<Void, Never>?

    public init(supervisor: EngineSupervisor) {
        self.supervisor = supervisor
    }

    public var client: EngineClient { supervisor.client }

    public var presentation: EngineStatusPresentation { EngineStatusPresentation(engineStatus) }

    /// Starts supervising the engine and following its status. Calling it again does nothing.
    public func start() {
        guard following == nil else { return }
        let supervisor = supervisor
        following = Task { [weak self] in
            let statuses = await supervisor.statuses()
            await supervisor.start()
            for await status in statuses {
                self?.engineStatus = status
            }
        }
    }

    public func retry() {
        let supervisor = supervisor
        Task { await supervisor.retry() }
    }
}
