import Foundation
import Observation
import PicaProtocol

/// Onboarding's state (docs/onboarding.md): each precondition's check, the step the user is on, and the first
/// workspace. The steps follow `Precondition.allCases`, then the workspace; a step is current until its check passes
/// (or, for GitHub, the user goes on without it), so passing a check advances.
@MainActor
@Observable
public final class OnboardingStore {
    public enum CheckState: Equatable, Sendable {
        case checking
        case done(CheckOutcome)
    }

    public enum Step: Equatable, Sendable {
        case check(Precondition)
        case workspace
    }

    public private(set) var checks: [Precondition: CheckState] = [:]
    public private(set) var skippedGitHub = false
    /// Set when performing a fix gave the user something to do, e.g. a copied command to run.
    public private(set) var fixNotes: [Precondition: String] = [:]
    public private(set) var isCreatingWorkspace = false
    public private(set) var workspaceProblem: String?

    @ObservationIgnored private let backend: any OnboardingBackend
    @ObservationIgnored private let performFix: @MainActor (FixAction) -> String?
    @ObservationIgnored private let createWorkspace: @MainActor (String) async -> String?
    @ObservationIgnored private var started = false

    /// `performFix` carries out a fix and returns a note for the user, if any. `createWorkspace` creates the first
    /// workspace and returns why it could not, or nil once it is created.
    public init(
        backend: any OnboardingBackend, performFix: @escaping @MainActor (FixAction) -> String?,
        createWorkspace: @escaping @MainActor (String) async -> String?
    ) {
        self.backend = backend
        self.performFix = performFix
        self.createWorkspace = createWorkspace
    }

    public var step: Step {
        for precondition in Precondition.allCases where !isSatisfied(precondition) {
            return .check(precondition)
        }
        return .workspace
    }

    public func state(of precondition: Precondition) -> CheckState? {
        checks[precondition]
    }

    public func isSatisfied(_ precondition: Precondition) -> Bool {
        if precondition == .github && skippedGitHub { return true }
        guard case .done(.passed) = checks[precondition] else { return false }
        return true
    }

    /// Runs every check once, together; later calls do nothing.
    public func start() async {
        guard !started else { return }
        started = true
        await withTaskGroup(of: Void.self) { group in
            for precondition in Precondition.allCases {
                group.addTask { await self.check(precondition) }
            }
        }
    }

    public func check(_ precondition: Precondition) async {
        checks[precondition] = .checking
        fixNotes[precondition] = nil
        let outcome: CheckOutcome
        do {
            outcome = try await answer(precondition)
        } catch {
            outcome = CheckOutcomes.failure(error)
        }
        checks[precondition] = .done(outcome)
    }

    public func fix(_ precondition: Precondition, with action: FixAction) {
        if action.kind == .retry {
            Task { await check(precondition) }
            return
        }
        fixNotes[precondition] = performFix(action)
    }

    public func skipGitHub() {
        skippedGitHub = true
    }

    /// Returns whether the workspace was created; on failure `workspaceProblem` says why.
    @discardableResult
    public func createFirstWorkspace(named name: String) async -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isCreatingWorkspace else { return false }
        isCreatingWorkspace = true
        defer { isCreatingWorkspace = false }
        workspaceProblem = await createWorkspace(trimmed)
        return workspaceProblem == nil
    }

    private func answer(_ precondition: Precondition) async throws -> CheckOutcome {
        switch precondition {
        case .copilot: CheckOutcomes.copilot(try await backend.copilotAccount())
        case .gitInstall: CheckOutcomes.git(try await backend.gitInstall())
        case .github: CheckOutcomes.gitHub(try await backend.gitHubAuth())
        }
    }
}
