import EngineClient
import Foundation
import PicaProtocol

/// A failed request as the workspace views show it: the engine's message, its stable code, and the action that fixes
/// it when the engine names one (`data.fix`, PLAN.md §4.5).
public struct WorkspaceProblem: Equatable, Sendable {
    public var message: String
    public var code: ErrorCode?
    public var fix: FixAction?

    public init(message: String, code: ErrorCode? = nil, fix: FixAction? = nil) {
        self.message = message
        self.code = code
        self.fix = fix
    }

    public init(_ error: any Error) {
        guard let clientError = error as? EngineClientError else {
            self.init(message: error.localizedDescription)
            return
        }
        switch clientError {
        case .engine(let rpcError):
            self.init(message: rpcError.message, code: rpcError.data?.code, fix: rpcError.data?.fix)
        case .notConnected, .disconnected:
            self.init(message: "Pica is not connected to its engine.", fix: FixAction(kind: .retry, label: "Try Again"))
        case .timedOut(let method, _):
            self.init(message: "The engine did not answer \(method) in time.", fix: FixAction(kind: .retry, label: "Try Again"))
        case .malformedResponse(let method):
            self.init(message: "The engine's answer to \(method) could not be read.")
        case .closed:
            self.init(message: "Pica's connection to its engine is closed.")
        case .socket(let socketError):
            self.init(message: "The engine's socket failed: \(socketError).")
        }
    }
}
