import AppShell
import EngineClient
import Foundation
import Onboarding
import PicaProtocol
import Workspaces

/// A-15: onboarding's checks (docs/onboarding.md), with A-12's fixes and workspace creation. Features meet here, in
/// the app target (PLAN.md §4.3).
@MainActor
enum AppOnboarding {
    /// UI tests other than onboarding's set `PICA_ONBOARDING=off`, since each starts with no workspace.
    static let isEnabled = ProcessInfo.processInfo.environment["PICA_ONBOARDING"] != "off"

    static func makeStore(client: EngineClient, workspaces: WorkspaceManager) -> OnboardingStore {
        OnboardingStore(
            backend: EngineOnboardingBackend(client: client),
            performFix: { [fixes = workspaces.fixes] fix in
                guard case .note(let note) = fixes.perform(fix) else { return nil }
                return note
            },
            createWorkspace: { [unowned workspaces] name in
                guard await workspaces.createWorkspace(named: name) else {
                    return workspaces.createProblem?.message ?? "The workspace could not be created."
                }
                return nil
            })
    }

    /// Until the engine has a workspace: creating the first one selects it and so ends onboarding.
    static func isNeeded(_ navigation: NavigationStore) -> Bool {
        isEnabled && navigation.hasLoaded && navigation.workspaces.isEmpty
    }
}
