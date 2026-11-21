import EngineClient
import PicaProtocol

/// What the app knows about its engine, as the window shows it.
public enum EngineStatus: Equatable, Sendable {
    /// The app is starting the engine or connecting to one that is already running.
    case starting
    case connected(EngineHelloResult)
    /// The connection was lost; the engine is being restarted and the client reconnects on its own.
    case reconnecting
    /// The engine speaks another protocol major version. Blocking: nothing works until Pica or the engine is replaced.
    /// `engine` is nil when the engine's refusal did not say which version it speaks.
    case incompatible(app: ProtocolVersion, engine: ProtocolVersion?)
    /// The engine could not be started; restarting stopped after repeated failures.
    case failed(EngineFailure)

    /// The status for a refused handshake, or nil when the error is not a protocol mismatch.
    static func incompatibility(_ error: EngineClientError, app: ProtocolVersion) -> EngineStatus? {
        guard error.code == .protocolVersionMismatch, case .engine(let refusal) = error else { return nil }
        let engine = refusal.data?.details?["engine"].flatMap(ProtocolVersion.init(json:))
        return .incompatible(app: app, engine: engine)
    }
}

/// Why the engine is not running. Every case has a stable code (PLAN.md §8).
public struct EngineFailure: Error, Equatable, Sendable {
    public enum Code: String, Sendable {
        case engineNotFound = "engine_not_found"
        case engineStartFailed = "engine_start_failed"
        case engineStartTimeout = "engine_start_timeout"
        /// H-05: the engine kept exiting soon after it started.
        case engineCrashLoop = "engine_crash_loop"
    }

    public var code: Code
    public var message: String

    public init(code: Code, message: String) {
        self.code = code
        self.message = message
    }
}

extension ProtocolVersion {
    init?(json: JSONValue) {
        guard case .object(let fields) = json,
              case .number(let major)? = fields["major"],
              case .number(let minor)? = fields["minor"]
        else { return nil }
        self.init(major: Count(major), minor: Count(minor))
    }

    public var displayed: String { "\(major).\(minor)" }
}
