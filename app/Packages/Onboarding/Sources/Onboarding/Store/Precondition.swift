import EngineClient
import Foundation
import PicaProtocol

/// What Pica needs before a first session (docs/onboarding.md), in the order onboarding walks them.
public enum Precondition: String, CaseIterable, Sendable {
    case copilot
    case gitInstall
    case github

    public var title: String {
        switch self {
        case .copilot: "GitHub Copilot"
        case .gitInstall: "Git"
        case .github: "GitHub"
        }
    }

    /// Without GitHub, repositories can still be added by path or URL; teams cannot be imported.
    public var isOptional: Bool { self == .github }
}

/// One check's answer: what passed, or what failed and the action that fixes it.
public enum CheckOutcome: Equatable, Sendable {
    case passed(String)
    case failed(message: String, fix: FixAction?)
}

/// Turns the engine's answers into outcomes. The fixes are commands for the user to run in a terminal, since the app
/// never runs them itself (PLAN.md §4.3).
enum CheckOutcomes {
    static let copilotSignIn = FixAction(kind: .runCommand, label: "Copy Sign-In Command", target: "copilot login")
    static let gitInstall = FixAction(kind: .runCommand, label: "Copy Install Command", target: "xcode-select --install")

    static func copilot(_ account: EngineAccountResult.Account) -> CheckOutcome {
        switch account.status {
        case .signedIn:
            .passed(account.login.map { "Signed in as \($0)." } ?? "Signed in.")
        case .unknown:
            .passed("The runtime needs no sign-in.")
        case .signedOut:
            .failed(message: account.message ?? "Pica is not signed in to GitHub Copilot.", fix: copilotSignIn)
        case .noModels:
            .failed(message: account.message ?? "GitHub Copilot offers this account no models.", fix: copilotSignIn)
        }
    }

    static func git(_ git: GitInstall) -> CheckOutcome {
        switch git.status {
        case .installed:
            .passed(git.version.map { "Git \($0)." } ?? "Git is installed.")
        case .missing:
            .failed(
                message: "Pica needs Git, which comes with Apple's Command Line Tools."
                    + (git.message.map { " Running it said: \($0)" } ?? ""),
                fix: gitInstall)
        }
    }

    static func gitHub(_ status: GitHubAuthStatus) -> CheckOutcome {
        guard status.signedIn else {
            return .failed(
                message: "Pica is not signed in to \(status.host), so it cannot list your teams.",
                fix: FixAction(kind: .signIn, label: "Sign in to \(status.host)", target: status.host))
        }
        return .passed(status.login.map { "Signed in to \(status.host) as \($0)." } ?? "Signed in to \(status.host).")
    }

    /// A request that failed: the engine's message and its fix when it names one.
    static func failure(_ error: any Error) -> CheckOutcome {
        guard let clientError = error as? EngineClientError else {
            return .failed(message: error.localizedDescription, fix: nil)
        }
        switch clientError {
        case .engine(let rpcError):
            return .failed(message: rpcError.message, fix: rpcError.data?.fix)
        case .notConnected, .disconnected, .closed:
            return .failed(message: "Pica is not connected to its engine.", fix: nil)
        case .timedOut(let method, _):
            return .failed(message: "The engine did not answer \(method) in time.", fix: nil)
        case .malformedResponse(let method):
            return .failed(message: "The engine's answer to \(method) could not be read.", fix: nil)
        case .socket(let socketError):
            return .failed(message: "The engine's socket failed: \(socketError).", fix: nil)
        }
    }
}
