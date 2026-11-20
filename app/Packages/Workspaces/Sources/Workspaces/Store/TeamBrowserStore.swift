import Foundation
import Observation
import PicaProtocol

extension GitHubTeam: @retroactive Identifiable {
    /// `org/slug`, unique on a GitHub host.
    public var id: String { "\(org)/\(slug)" }
}

/// The team browser (docs/workspaces.md): the signed-in user's GitHub teams, searched and chosen several at a time,
/// with the focused team's repos as a preview, imported into a workspace as team sources and synced.
@MainActor
@Observable
public final class TeamBrowserStore {
    public enum Phase: Equatable, Sendable {
        case loading
        case loaded
        /// Not signed in, or the teams could not be listed; the problem carries the fix.
        case failed(WorkspaceProblem)
    }

    public enum Preview: Equatable, Sendable {
        case none
        case loading(GitHubTeam.ID)
        case loaded(GitHubTeam.ID, [GitHubRepo])
        case failed(GitHubTeam.ID, WorkspaceProblem)
    }

    public enum ImportState: Equatable, Sendable {
        case idle
        case importing
        case failed(WorkspaceProblem)
    }

    public private(set) var phase: Phase = .loading
    public private(set) var account: GitHubAuthStatus?
    public private(set) var teams: [GitHubTeam] = []
    public var query = ""
    public private(set) var selected: Set<GitHubTeam.ID> = []
    public var focused: GitHubTeam.ID?
    public private(set) var preview: Preview = .none
    public private(set) var importState: ImportState = .idle

    @ObservationIgnored private let backend: any WorkspacesBackend

    public init(backend: any WorkspacesBackend) {
        self.backend = backend
    }

    /// The teams whose name, slug or organization contains every word of the query, ignoring case.
    public var visibleTeams: [GitHubTeam] {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return teams }
        return teams.filter { team in
            let haystack = "\(team.name) \(team.org)/\(team.slug)".lowercased()
            return words.allSatisfy { haystack.contains($0) }
        }
    }

    /// The chosen teams in the order they are listed.
    public var selectedTeams: [GitHubTeam] {
        teams.filter { selected.contains($0.id) }
    }

    public var isImporting: Bool { importState == .importing }

    public func load() async {
        phase = .loading
        do {
            let status = try await backend.authStatus()
            account = status
            guard status.signedIn else {
                phase = .failed(WorkspaceProblem(
                    message: "Pica is not signed in to \(status.host), so it cannot list your teams.",
                    code: .authRequired,
                    fix: FixAction(kind: .signIn, label: "Sign in to \(status.host)", target: status.host)))
                return
            }
            teams = try await backend.teams()
            selected.formIntersection(teams.map(\.id))
            phase = .loaded
        } catch {
            phase = .failed(WorkspaceProblem(error))
        }
    }

    public func isSelected(_ team: GitHubTeam) -> Bool {
        selected.contains(team.id)
    }

    public func toggle(_ team: GitHubTeam) {
        if selected.remove(team.id) == nil { selected.insert(team.id) }
    }

    public func setSelected(_ isSelected: Bool, _ team: GitHubTeam) {
        if isSelected { selected.insert(team.id) } else { selected.remove(team.id) }
    }

    /// Selects every visible team, or clears them all when every visible team is already selected.
    public func toggleAllVisible() {
        let visible = Set(visibleTeams.map(\.id))
        if visible.isSubset(of: selected) {
            selected.subtract(visible)
        } else {
            selected.formUnion(visible)
        }
    }

    /// Lists the focused team's repos, as the sync will see them.
    public func loadPreview() async {
        guard let id = focused, let team = teams.first(where: { $0.id == id }) else {
            preview = .none
            return
        }
        preview = .loading(id)
        do {
            let repos = try await backend.teamRepos(org: team.org, teamSlug: team.slug)
            if focused == id { preview = .loaded(id, repos) }
        } catch {
            if focused == id { preview = .failed(id, WorkspaceProblem(error)) }
        }
    }

    /// Adds each chosen team as a source of the workspace, skipping teams it already has, then syncs it. Returns
    /// whether the import finished; the sources stay added when the sync fails, so syncing again later retries them.
    @discardableResult
    public func importSelected(into workspace: WorkspaceStore) async -> Bool {
        let teams = selectedTeams
        guard !teams.isEmpty, !isImporting else { return false }
        importState = .importing
        for team in teams {
            do {
                _ = try await backend.addTeamSource(to: workspace.workspaceId, org: team.org, teamSlug: team.slug)
            } catch {
                let problem = WorkspaceProblem(error)
                if problem.code == .alreadyExists { continue }
                importState = .failed(problem)
                return false
            }
        }
        if let problem = await workspace.syncAfterImport() {
            importState = .failed(problem)
            return false
        }
        importState = .idle
        selected = []
        return true
    }
}
