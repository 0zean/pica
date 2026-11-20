import AppKit
import Foundation
import PicaProtocol

/// Carries out an error's `fix` action (docs/workspaces.md). URLs open in the browser; commands, including signing in
/// with the GitHub CLI, are copied for the user to run in a terminal, since the app never runs `gh` itself (PLAN.md
/// §4.3). UI tests set `PICA_FIX_ACTION_LOG` to a file, and each action is appended to it as `kind target` instead.
public struct FixPerformer: Sendable {
    public enum Outcome: Equatable, Sendable {
        case done
        /// Shown under the problem, telling the user what to do next.
        case note(String)
        /// The caller does the action: try the request again, or open Settings.
        case retry
        case openSettings
    }

    private let openURL: @Sendable (URL) -> Void
    private let copy: @Sendable (String) -> Void

    public init(openURL: @escaping @Sendable (URL) -> Void, copy: @escaping @Sendable (String) -> Void) {
        self.openURL = openURL
        self.copy = copy
    }

    public static func system(environment: [String: String]) -> FixPerformer {
        if let log = environment["PICA_FIX_ACTION_LOG"] {
            return FixPerformer(
                openURL: { append("open_url \($0.absoluteString)\n", to: log) },
                copy: { append("copy \($0)\n", to: log) })
        }
        return FixPerformer(
            openURL: { url in Task { @MainActor in NSWorkspace.shared.open(url) } },
            copy: { text in
                Task { @MainActor in
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(text, forType: .string)
                }
            })
    }

    public func perform(_ fix: FixAction) -> Outcome {
        switch fix.kind {
        case .openUrl:
            guard let target = fix.target, let url = URL(string: target) else { return .note("No address to open.") }
            openURL(url)
            return .done
        case .runCommand:
            guard let command = fix.target else { return .note("No command to run.") }
            copy(command)
            return .note("Copied “\(command)”. Run it in Terminal, then try again.")
        case .signIn:
            let command = Self.signInCommand(host: fix.target)
            copy(command)
            return .note("Copied “\(command)”. Run it in Terminal, then try again.")
        case .retry:
            return .retry
        case .openSettings:
            return .openSettings
        }
    }

    /// Discovery signs in with the GitHub CLI's credentials (R-04).
    static func signInCommand(host: String?) -> String {
        guard let host, host != "github.com" else { return "gh auth login --scopes read:org" }
        return "gh auth login --hostname \(host) --scopes read:org"
    }

    private static func append(_ line: String, to path: String) {
        let data = Data(line.utf8)
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            FileManager.default.createFile(atPath: path, contents: data)
        }
    }
}
