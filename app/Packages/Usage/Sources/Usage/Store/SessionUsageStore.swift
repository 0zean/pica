import Observation
import PicaProtocol

/// The chip popover's breakdown of one session, asked for each time the popover opens.
@MainActor
@Observable
public final class SessionUsageStore {
    public let sessionId: Id
    public private(set) var breakdown: SessionUsageBreakdown?
    public private(set) var failure: String?

    private let backend: any UsageBackend

    public init(sessionId: Id, backend: any UsageBackend) {
        self.sessionId = sessionId
        self.backend = backend
    }

    public func load() async {
        do {
            async let agent = backend.rollup(UsageRollupParams(groupBy: .agent, sessionId: sessionId))
            async let model = backend.rollup(UsageRollupParams(groupBy: .model, sessionId: sessionId))
            breakdown = try await SessionUsageBreakdown(byAgent: agent, byModel: model)
            failure = nil
        } catch {
            guard !(error is CancellationError) else { return }
            failure = UsageFailure.message(error)
        }
    }
}
