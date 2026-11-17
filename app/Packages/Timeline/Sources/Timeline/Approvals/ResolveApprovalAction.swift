import EngineClient
import PicaProtocol
import SwiftUI

/// Answers an approval (A-07). `SessionTimelineScreen` gives its rows one that calls `approval.resolve`; without one
/// in the environment an approval shows its choices disabled, as in snapshots.
public struct ResolveApprovalAction: Sendable {
    private let resolve: @Sendable (Id, ApprovalChoice) async throws -> Void

    public init(_ resolve: @escaping @Sendable (_ approvalId: Id, _ choice: ApprovalChoice) async throws -> Void) {
        self.resolve = resolve
    }

    /// Resolves through the engine. A budget approval that is allowed raises the session's limit by the configured
    /// session budget, as `approval.resolve` does without `budgetCredits`.
    public static func engine(_ client: EngineClient) -> ResolveApprovalAction {
        ResolveApprovalAction { approvalId, choice in
            _ = try await client.request(
                Methods.ApprovalResolve.self, ApprovalResolveParams(approvalId: approvalId, choice: choice))
        }
    }

    func callAsFunction(approvalId: Id, choice: ApprovalChoice) async throws {
        try await resolve(approvalId, choice)
    }

    static func describe(_ error: any Error) -> String {
        if case .engine(let rpcError)? = error as? EngineClientError {
            return rpcError.message
        }
        return String(describing: error)
    }
}

extension EnvironmentValues {
    @Entry public var resolveApproval: ResolveApprovalAction?
}
