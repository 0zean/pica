import EngineClient
import Observation
import PicaProtocol

/// The app-wide store: the engine's status as the window shows it (EngineClient → store → view, PLAN.md §8).
@Observable @MainActor
public final class AppModel {
    public private(set) var engineStatus = EngineStatus.starting
    /// H-05: the damaged database the engine moved aside when it started, until the notice is dismissed.
    public private(set) var storeRecovery: EngineHealthResult.StoreRecovery?
    @ObservationIgnored private var dismissedBackups: Set<String> = []
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
                if case .connected = status { await self?.checkStoreRecovery() }
            }
        }
    }

    public func dismissStoreRecovery() {
        if let backupPath = storeRecovery?.backupPath { dismissedBackups.insert(backupPath) }
        storeRecovery = nil
    }

    private func checkStoreRecovery() async {
        guard let health = try? await client.request(Methods.EngineHealth.self, Empty()) else { return }
        storeRecovery = health.storeRecovery.flatMap { dismissedBackups.contains($0.backupPath) ? nil : $0 }
    }

    public func retry() {
        let supervisor = supervisor
        Task { await supervisor.retry() }
    }
}
