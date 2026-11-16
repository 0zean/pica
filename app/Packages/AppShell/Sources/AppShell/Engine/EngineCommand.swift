import Foundation

/// How the app runs `picad`: an executable, the arguments before `--socket`, and environment added to the app's own.
public struct EngineCommand: Equatable, Sendable {
    public var executable: URL
    public var arguments: [String]
    public var environment: [String: String]

    public init(executable: URL, arguments: [String], environment: [String: String] = [:]) {
        self.executable = executable
        self.arguments = arguments
        self.environment = environment
    }

    /// A development engine when `PICA_ENGINE_ENTRY` names a TypeScript entry (run by the Node at `PICA_NODE`),
    /// otherwise the engine bundled in the app (S-05 layout, `docs/app-shell.md`).
    public static func resolve(environment: [String: String], bundle: Bundle) -> Result<EngineCommand, EngineFailure> {
        if let entry = environment["PICA_ENGINE_ENTRY"] {
            guard let node = environment["PICA_NODE"] else {
                return .failure(EngineFailure(
                    code: .engineNotFound, message: "PICA_ENGINE_ENTRY is set, but PICA_NODE does not name a Node executable."))
            }
            return .success(development(node: URL(filePath: node), entry: URL(filePath: entry)))
        }
        return bundled(in: bundle)
    }

    public static func development(node: URL, entry: URL) -> EngineCommand {
        EngineCommand(
            executable: node,
            arguments: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", entry.path])
    }

    static func bundled(in bundle: Bundle) -> Result<EngineCommand, EngineFailure> {
        let contents = bundle.bundleURL.appending(path: "Contents")
        let node = contents.appending(path: "Helpers/node")
        let resources = contents.appending(path: "Resources")
        let entry = resources.appending(path: "engine/picad.mjs")
        let copilot = resources.appending(path: "copilot/prebuilds/darwin-arm64/copilot-runtime")
        for required in [node, entry] where !FileManager.default.fileExists(atPath: required.path) {
            return .failure(EngineFailure(
                code: .engineNotFound, message: "This copy of Pica has no engine: \(required.path) is missing."))
        }
        return .success(EngineCommand(
            executable: node, arguments: [entry.path], environment: ["COPILOT_CLI_PATH": copilot.path]))
    }
}
