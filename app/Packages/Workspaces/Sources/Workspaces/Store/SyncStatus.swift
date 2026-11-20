import Foundation
import PicaProtocol

/// How the workspace screen words sync state and clone state (docs/workspaces.md).
public enum SyncStatus {
    /// "Synced 5 minutes ago", or "Not synced yet" for a source that never synced.
    public static func sourceLabel(lastSyncedAt: Timestamp?, now: Date) -> String {
        guard let lastSyncedAt, let date = parse(lastSyncedAt) else { return "Not synced yet" }
        if now.timeIntervalSince(date) < 60 { return "Synced just now" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return "Synced \(formatter.localizedString(for: date, relativeTo: now))"
    }

    /// The line under the workspace's Sync button.
    public static func summary(_ state: WorkspaceStore.SyncState, sources: Int) -> String {
        switch state {
        case .idle:
            sources == 0 ? "Import a team to sync repos from GitHub." : "Sync lists each source's repos on GitHub again."
        case .syncing:
            "Syncing…"
        case .synced(let added, let removed):
            switch (added, removed) {
            case (0, 0): "Up to date."
            case (_, 0): "Synced: \(repos(added)) added."
            case (0, _): "Synced: \(repos(removed)) removed."
            default: "Synced: \(repos(added)) added, \(removed) removed."
            }
        case .failed:
            "Sync failed."
        }
    }

    public static func cloneLabel(_ state: CloneState) -> String {
        switch state {
        case .available: "Available"
        case .cloning: "Cloning"
        case .cloned: "Cloned"
        case .failed: "Clone failed"
        }
    }

    private static func repos(_ count: Int) -> String {
        count == 1 ? "1 repo" : "\(count) repos"
    }

    private static func parse(_ timestamp: Timestamp) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp)
    }
}

extension Repo {
    /// The last component of the remote, else of the local path, without `.git`.
    var name: String {
        let source = remoteUrl ?? localPath ?? id
        let last = source.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init) ?? source
        return last.hasSuffix(".git") ? String(last.dropLast(4)) : last
    }
}

extension RepoSource {
    /// "Team acme/platform", "Topic acme · payments".
    var title: String {
        let org = org ?? ""
        switch kind {
        case .team: return "Team \(org)/\(selector ?? "")"
        case .topic: return "Topic \(org) · \(selector ?? "")"
        case .property: return "Property \(org) · \(selector ?? "")"
        case .manual: return "Added by hand"
        }
    }

    /// The accessibility identifier's suffix.
    var key: String {
        "\(kind.rawValue).\(org ?? "")/\(selector ?? "")"
    }
}
