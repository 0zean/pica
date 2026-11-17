import Foundation
import PicaProtocol

/// A file in a workspace repo: what the viewer opens and the external editor is given.
public struct FileReference: Codable, Hashable, Sendable {
    public var repoId: Id
    /// The repo's short name, as the sidebar shows it.
    public var repoName: String
    /// Repo-relative.
    public var path: String
    /// The repo's checkout; nil when it is not cloned.
    public var repoPath: String?

    public init(repoId: Id, repoName: String, path: String, repoPath: String?) {
        self.repoId = repoId
        self.repoName = repoName
        self.path = path
        self.repoPath = repoPath
    }

    public var fileName: String { path.split(separator: "/").last.map(String.init) ?? path }

    /// Where the file is on disk, for the external editor.
    public var fileURL: URL? {
        repoPath.map { URL(filePath: $0).appending(path: path) }
    }
}

extension Repo {
    /// The last component of the remote, else of the local path, without `.git` (the sidebar's name for it).
    var shortName: String {
        let source = remoteUrl ?? localPath ?? id
        let last = source.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init) ?? source
        return last.hasSuffix(".git") ? String(last.dropLast(4)) : last
    }
}
