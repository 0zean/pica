import Foundation
import PicaProtocol

/// A repo the composer can mention: its name in mentions, and where its files are for this session.
public struct MentionRepo: Equatable, Sendable {
    public var id: Id
    public var name: String
    /// The session's worktree for a write repo, else the repo's local checkout; nil when it has neither.
    public var path: String?

    public init(id: Id, name: String, path: String?) {
        self.id = id
        self.name = name
        self.path = path
    }

    /// The name a repo goes by in mentions: the last part of its remote URL or path, without `.git`. AppShell's
    /// sidebar names repos the same way.
    public static func name(of repo: Repo) -> String {
        let source = repo.remoteUrl ?? repo.localPath ?? repo.id
        let last = source.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init) ?? source
        return last.hasSuffix(".git") ? String(last.dropLast(4)) : last
    }
}

/// What a mention names, once the session's repos and agents are known.
public enum MentionTarget: Equatable, Sendable {
    case repo(MentionRepo)
    case file(MentionRepo, path: String)
    case agent(String)
    case unknown
}

/// Resolves mention names: an agent's name, a repo's name, or `repo:path` for a file in a repo. An agent wins over
/// a repo of the same name.
public struct MentionResolver: Sendable {
    public var repos: [MentionRepo]
    public var agents: [String]

    public init(repos: [MentionRepo], agents: [String]) {
        self.repos = repos
        self.agents = agents
    }

    public func resolve(_ name: String) -> MentionTarget {
        if agents.contains(name) { return .agent(name) }
        if let repo = repos.first(where: { $0.name == name }) { return .repo(repo) }
        if let colon = name.firstIndex(of: ":") {
            let repoName = String(name[..<colon])
            let path = String(name[name.index(after: colon)...])
            if !path.isEmpty, let repo = repos.first(where: { $0.name == repoName }) { return .file(repo, path: path) }
        }
        return .unknown
    }

    /// The message sent for `text`: the text as written, and when it mentions repos or files whose location is known,
    /// a closing list of where they are, so the agent need not guess (docs/composer.md).
    public func message(for text: String) -> String {
        var seen = Set<String>()
        var lines: [String] = []
        for token in MentionTokenizer.tokens(in: text) where token.kind == .mention && seen.insert(token.name).inserted {
            switch resolve(token.name) {
            case .repo(let repo):
                if let path = repo.path { lines.append("@\(token.name): \(path)") }
            case .file(let repo, let path):
                if let root = repo.path { lines.append("@\(token.name): \(root)/\(path)") }
            case .agent, .unknown:
                break
            }
        }
        guard !lines.isEmpty else { return text }
        return text + "\n\n---\n" + lines.joined(separator: "\n")
    }
}

/// How a mention or skill is written into the text: quoted when the name has a space.
enum MentionText {
    static func mention(_ name: String) -> String {
        name.contains(where: \.isWhitespace) ? "@\"\(name)\"" : "@\(name)"
    }

    static func skill(_ name: String) -> String {
        "/\(name)"
    }
}
