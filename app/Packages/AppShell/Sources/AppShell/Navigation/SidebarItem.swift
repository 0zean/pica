import PicaProtocol

/// A row of the sidebar, and what the window has selected.
public enum SidebarItem: Hashable, Codable, Sendable {
    case workspace(Id)
    /// A repo appears under each workspace that includes it, so its row is identified by both.
    case repo(workspaceId: Id, repoId: Id)
    case session(Id)
}

/// One workspace as the sidebar shows it: its repos in the engine's order, then its sessions, those needing attention first.
public struct SidebarWorkspace: Identifiable, Equatable, Sendable {
    public var workspace: Workspace
    public var repos: [Repo]
    public var sessions: [Session]

    public var id: Id { workspace.id }

    public var items: [SidebarItem] {
        [.workspace(workspace.id)]
            + repos.map { .repo(workspaceId: workspace.id, repoId: $0.id) }
            + sessions.map { .session($0.id) }
    }
}

public enum SessionOrdering {
    /// Sessions waiting on the user, then the rest; most recently updated first within each group.
    public static func sorted(_ sessions: some Sequence<Session>) -> [Session] {
        sessions.sorted { left, right in
            let leftAttention = left.state.needsAttention
            if leftAttention != right.state.needsAttention { return leftAttention }
            if left.updatedAt != right.updatedAt { return left.updatedAt > right.updatedAt }
            return left.id < right.id
        }
    }
}

extension SessionState {
    /// The session cannot go on until the user acts: it is waiting for an approval, or it failed.
    public var needsAttention: Bool {
        self == .awaitingApproval || self == .failed
    }
}

extension Session {
    public var displayTitle: String {
        title.isEmpty ? "Untitled session" : title
    }
}

extension Repo {
    /// The last component of the remote, else of the local path, without `.git`.
    public var displayName: String {
        let source = remoteUrl ?? localPath ?? id
        let last = source.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init) ?? source
        return last.hasSuffix(".git") ? String(last.dropLast(4)) : last
    }
}

/// A rename or delete the window is asking the user about.
public enum PendingSessionAction: Hashable, Sendable {
    case rename(Id)
    case delete(Id)

    public var sessionId: Id {
        switch self {
        case .rename(let id), .delete(let id): id
        }
    }
}
