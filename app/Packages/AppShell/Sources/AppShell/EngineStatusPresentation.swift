/// What the window says about the engine's status.
public struct EngineStatusPresentation: Equatable, Sendable {
    public enum Style: Equatable, Sendable {
        /// Nothing is shown.
        case hidden
        /// A banner above the content, which stays usable.
        case banner
        /// A panel over the content, which cannot be used until the problem is resolved.
        case blocking
    }

    public var style: Style
    public var title: String
    public var message: String
    /// The stable error code shown with a blocking problem.
    public var code: String?
    public var offersRetry: Bool

    public init(_ status: EngineStatus) {
        switch status {
        case .connected:
            self.init(style: .hidden, title: "", message: "")
        case .starting:
            self.init(style: .banner, title: "Starting the engine…", message: "")
        case .reconnecting:
            self.init(
                style: .banner, title: "Reconnecting to the engine…",
                message: "The connection was lost. Pica is restarting the engine and will pick up where it left off.")
        case .incompatible(let app, let engine):
            let engineVersion = engine.map { "protocol \($0.displayed)" } ?? "a different protocol version"
            self.init(
                style: .blocking, title: "This engine can't be used",
                message: "Pica speaks protocol \(app.displayed), but the engine speaks \(engineVersion). "
                    + "Quit Pica, stop any other Pica engine, and install a matching version of Pica.",
                code: "protocol_version_mismatch")
        case .failed(let failure):
            let title = failure.code == .engineCrashLoop ? "The engine keeps stopping" : "The engine could not start"
            self.init(
                style: .blocking, title: title, message: failure.message,
                code: failure.code.rawValue, offersRetry: true)
        }
    }

    private init(style: Style, title: String, message: String, code: String? = nil, offersRetry: Bool = false) {
        self.style = style
        self.title = title
        self.message = message
        self.code = code
        self.offersRetry = offersRetry
    }
}
