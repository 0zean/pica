import EngineClient
import Foundation
import Observation
import PicaProtocol

/// One file, read from the engine for the read-only viewer.
@MainActor
@Observable
public final class FileViewerStore {
    public enum Content: Equatable, Sendable {
        case loading
        case text(String, truncated: Bool, sizeBytes: Int)
        /// The engine would not show it (binary, gone, outside the repo); the message says why.
        case unavailable(String)
    }

    public let reference: FileReference
    public private(set) var content: Content = .loading

    @ObservationIgnored private let backend: any FilesBackend

    public init(reference: FileReference, backend: any FilesBackend) {
        self.reference = reference
        self.backend = backend
    }

    public func load() async {
        do {
            let file = try await backend.read(repoId: reference.repoId, path: reference.path)
            content = .text(file.text, truncated: file.truncated, sizeBytes: file.sizeBytes)
        } catch {
            content = .unavailable(Self.describe(error))
        }
    }

    static func describe(_ error: any Error) -> String {
        guard case EngineClientError.engine(let rpc) = error else { return "The engine could not be reached." }
        if rpc.data?.details?["reason"] == .string("files.binary") {
            return "This is a binary file, which the viewer does not show."
        }
        return rpc.message
    }
}
