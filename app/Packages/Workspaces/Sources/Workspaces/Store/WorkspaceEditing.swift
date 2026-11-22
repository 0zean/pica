import Foundation
import PicaProtocol

/// Why a workspace name cannot be used, or nil when it can (docs/workspaces.md, "Renaming").
public enum WorkspaceNaming {
    /// `renaming` is the workspace being renamed, which may keep its own name.
    public static func problem(for name: String, renaming workspaceId: Id?, among workspaces: [Workspace]) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Enter a name." }
        let taken = workspaces.first { workspace in
            workspace.id != workspaceId
                && workspace.name.trimmingCharacters(in: .whitespacesAndNewlines)
                    .compare(trimmed, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
        }
        if let taken { return "Another workspace is already named “\(taken.name)”." }
        return nil
    }
}

/// What deleting a workspace does, as its confirmation says it (docs/workspaces.md, "Deleting a workspace").
public struct WorkspaceDeletion: Identifiable, Equatable, Sendable {
    public let workspace: Workspace
    public let repoCount: Int
    public let sessionCount: Int
    /// Idle sessions, which the engine ends before deleting.
    public let idleCount: Int
    /// Starting, running or waiting for an approval: the engine refuses while any is.
    public let busyCount: Int

    public var id: Id { workspace.id }

    public init(workspace: Workspace, repos: [Repo], sessions: [Session]) {
        self.workspace = workspace
        repoCount = repos.count
        sessionCount = sessions.count
        idleCount = sessions.filter { $0.state == .idle }.count
        busyCount = sessions.filter { Self.busyStates.contains($0.state) }.count
    }

    static let busyStates: Set<SessionState> = [.starting, .running, .awaitingApproval]

    public var isBlocked: Bool { busyCount > 0 }

    public var title: String {
        isBlocked ? "“\(workspace.name)” has sessions at work" : "Delete “\(workspace.name)”?"
    }

    public var message: String {
        if isBlocked {
            let these = busyCount == 1 ? "1 session is" : "\(busyCount) sessions are"
            return "\(these) working or waiting for an approval. Stop \(busyCount == 1 ? "it" : "them") or let "
                + "\(busyCount == 1 ? "it" : "them") finish, then delete the workspace."
        }
        var parts: [String] = []
        switch sessionCount {
        case 0: parts.append("It has no sessions.")
        case 1: parts.append("Its session is deleted with its transcript and usage history.")
        default: parts.append("Its \(sessionCount) sessions are deleted with their transcripts and usage history.")
        }
        if idleCount > 0 {
            parts.append(idleCount == 1 ? "The open session is ended first." : "The \(idleCount) open sessions are ended first.")
        }
        parts.append("Its sources and settings go too.")
        let repos = repoCount == 1 ? "Its repo stays" : repoCount == 0 ? "Repos stay" : "Its \(repoCount) repos stay"
        parts.append("\(repos) registered, and nothing on disk is deleted: folders and clones stay where they are.")
        parts.append("This can’t be undone.")
        return parts.joined(separator: " ")
    }
}

/// What removing a repo from a workspace does, as its confirmation says it (docs/workspaces.md, "Removing a repo").
public struct RepoRemoval: Identifiable, Equatable, Sendable {
    public let repo: Repo
    public let workspace: Workspace

    public var id: Id { repo.id }

    public init(repo: Repo, workspace: Workspace) {
        self.repo = repo
        self.workspace = workspace
    }

    public var name: String {
        repo.name
    }

    /// Only a clone Pica made can be deleted from here; a folder the user added is theirs.
    public var canDeleteClone: Bool {
        repo.managed && repo.localPath != nil
    }

    public var title: String {
        "Remove “\(name)” from “\(workspace.name)”?"
    }

    public var message: String {
        var parts: [String] = []
        let pinned = workspace.pinnedRepoIds.contains(repo.id)
        let teams = workspace.sources.filter { $0.kind != .manual }
        if !pinned, teams.count == 1, let team = teams.first {
            parts.append("It came from \(team.title.prefix(1).lowercased() + team.title.dropFirst()); Sync won’t add it back.")
        } else if !pinned, !teams.isEmpty {
            parts.append("It came from one of the workspace’s teams; Sync won’t add it back.")
        } else if !teams.isEmpty {
            parts.append("Sync won’t add it back from the workspace’s teams.")
        }
        if let path = repo.localPath {
            if repo.managed {
                parts.append("Its clone at \(path) stays on disk unless you choose Remove and Delete Clone, which "
                    + "Pica refuses if the clone has uncommitted changes or unpushed commits, or another workspace "
                    + "includes the repo.")
            } else {
                parts.append("Its folder at \(path) stays where it is.")
            }
        } else {
            parts.append("It was never cloned, so nothing is on disk.")
        }
        parts.append("Add it again by path or URL to bring it back.")
        return parts.joined(separator: " ")
    }
}
