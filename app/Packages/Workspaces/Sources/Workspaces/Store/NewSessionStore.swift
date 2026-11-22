import Foundation
import Observation
import PicaProtocol

/// New Session (docs/workspaces.md): which of the workspace's repos the session writes to and which it reads, its
/// mode and models, its first prompt, and starting it with `session.create`. A repo the engine has not cloned cannot be a root, so the
/// sheet offers to clone it first.
@MainActor
@Observable
public final class NewSessionStore {
    public enum Role: String, CaseIterable, Sendable {
        case unused
        case write
        case reference
    }

    public let workspaceId: Id
    public var prompt = ""
    public private(set) var roles: [Id: Role] = [:]
    public private(set) var isStarting = false
    public private(set) var problem: WorkspaceProblem?
    /// The repos being cloned from this sheet.
    public private(set) var cloning: Set<Id> = []
    public private(set) var cloneProblem: WorkspaceProblem?
    /// Repos this sheet cloned, as the engine answered: no notification reports a clone (docs/workspaces.md), so the
    /// list the sheet is given still says available.
    public private(set) var cloned: [Id: Repo] = [:]
    /// The modes and models the sheet offers; nil until loaded, or when they could not be.
    public private(set) var routing: NewSessionRouting?
    /// The session's mode; nil leaves it to the engine's default for the workspace (until `routing` loads).
    public private(set) var profile: RoutingProfile?
    /// Each tier's chosen setting: a model id or "auto". A tier not here keeps the config's setting.
    public private(set) var tierChoices: [Tier: String] = [:]

    @ObservationIgnored private let backend: any WorkspacesBackend
    /// Whether the roles were defaulted for the repos the sheet first saw.
    @ObservationIgnored private var defaulted = false

    public init(workspaceId: Id, backend: any WorkspacesBackend) {
        self.workspaceId = workspaceId
        self.backend = backend
    }

    /// A repo is a usable root once it has a local path (the engine's `session.create` refuses one without).
    public static func isUsable(_ repo: Repo) -> Bool {
        repo.localPath != nil
    }

    /// Why New Session cannot start in this workspace, or nil when it can.
    public static func unavailableReason(workspaceId: Id?, repos: [Repo]) -> String? {
        guard workspaceId != nil else { return "Select a workspace to start a session in." }
        guard !repos.isEmpty else { return "Add a repository to this workspace first." }
        return nil
    }

    /// The workspace's repos with the ones cloned here brought up to date.
    public func current(_ repos: [Repo]) -> [Repo] {
        repos.map { cloned[$0.id] ?? $0 }
    }

    public func role(of repoId: Id) -> Role {
        roles[repoId] ?? .unused
    }

    public func setRole(_ role: Role, for repoId: Id) {
        roles[repoId] = role == .unused ? nil : role
        problem = nil
    }

    /// Loads the modes and models; the mode starts as the workspace's default unless one was chosen meanwhile.
    public func loadRouting() async {
        guard let loaded = try? await backend.routing(workspaceId: workspaceId) else { return }
        routing = loaded
        if profile == nil || loaded.profileLock != nil { profile = loaded.defaultProfile }
    }

    public func setProfile(_ profile: RoutingProfile) {
        guard routing?.profileLock == nil else { return }
        self.profile = profile
    }

    /// The tier's setting for this session: the chosen one, else the config's.
    public func tierSetting(_ tier: Tier) -> String {
        tierChoices[tier] ?? routing?.setting(tier) ?? "auto"
    }

    public func setTier(_ tier: Tier, to setting: String) {
        guard routing?.tierLocks[tier] == nil else { return }
        tierChoices[tier] = setting
    }

    /// The tiers whose setting differs from the config's, so a session left on the defaults follows them.
    func requestedTiers() -> SessionModelTiers? {
        let changed = Tier.allCases.filter { tier in
            tierChoices[tier].map { $0 != routing?.setting(tier) } ?? false
        }
        guard !changed.isEmpty else { return nil }
        var tiers = SessionModelTiers()
        for tier in changed {
            switch tier {
            case .reasoning: tiers.reasoning = tierChoices[tier]
            case .worker: tiers.worker = tierChoices[tier]
            }
        }
        return tiers
    }

    /// With one usable repo the session writes to it, so the common case needs only a prompt. Runs once.
    public func applyDefaults(repos: [Repo]) {
        guard !defaulted else { return }
        defaulted = true
        let usable = current(repos).filter(Self.isUsable)
        if usable.count == 1, roles.isEmpty {
            roles[usable[0].id] = .write
        }
    }

    /// The chosen repo ids in the workspace's order, dropping any that are gone or no longer usable.
    func chosen(_ role: Role, in repos: [Repo]) -> [Id] {
        current(repos).filter { Self.isUsable($0) && self.role(of: $0.id) == role }.map(\.id)
    }

    /// Why Start is off, or nil when it can run.
    public func startBlocker(repos: [Repo]) -> String? {
        if let reason = Self.unavailableReason(workspaceId: workspaceId, repos: repos) { return reason }
        if !current(repos).contains(where: Self.isUsable) { return "Clone a repository to start a session in it." }
        if chosen(.write, in: repos).isEmpty, chosen(.reference, in: repos).isEmpty {
            return "Choose a repository to write to or reference."
        }
        if isStarting { return "Starting…" }
        return nil
    }

    /// Starts the session; returns it, or nil with `problem` saying why.
    public func start(repos: [Repo]) async -> Session? {
        guard startBlocker(repos: repos) == nil else { return nil }
        isStarting = true
        defer { isStarting = false }
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let session = try await backend.createSession(
                workspaceId: workspaceId, writeRepoIds: chosen(.write, in: repos),
                referenceRepoIds: chosen(.reference, in: repos), routingProfile: profile, modelTiers: requestedTiers(),
                prompt: trimmed.isEmpty ? nil : trimmed)
            problem = nil
            return session
        } catch {
            problem = WorkspaceProblem(error)
            return nil
        }
    }

    /// Clones a repo that is listed but not cloned (`repo.addUrl` clones a registered repo in place). The repo list
    /// keeps the engine's answer; the cloned repo becomes a write root when nothing else is chosen yet.
    public func clone(_ repo: Repo) async {
        guard let url = repo.remoteUrl, !cloning.contains(repo.id) else { return }
        cloning.insert(repo.id)
        defer { cloning.remove(repo.id) }
        do {
            let result = try await backend.addRepo(url: url)
            cloned[result.id] = result
            cloneProblem = nil
            if roles.isEmpty { roles[result.id] = .write }
        } catch {
            cloneProblem = WorkspaceProblem(error)
        }
    }
}
