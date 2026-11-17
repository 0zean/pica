import AppKit
import Foundation

/// Opens a file in the app macOS opens it with, the user's editor for that kind of file. UI tests set
/// `PICA_EXTERNAL_EDITOR_LOG` to a file, and the paths are appended to it instead.
public struct ExternalEditor: Sendable {
    private let open: @Sendable (URL) -> Void

    public init(open: @escaping @Sendable (URL) -> Void) {
        self.open = open
    }

    public static func system(environment: [String: String]) -> ExternalEditor {
        if let log = environment["PICA_EXTERNAL_EDITOR_LOG"] {
            return ExternalEditor { url in
                let line = Data((url.path + "\n").utf8)
                if let handle = FileHandle(forWritingAtPath: log) {
                    handle.seekToEndOfFile()
                    handle.write(line)
                    try? handle.close()
                } else {
                    FileManager.default.createFile(atPath: log, contents: line)
                }
            }
        }
        return ExternalEditor { url in
            Task { @MainActor in NSWorkspace.shared.open(url) }
        }
    }

    public func callAsFunction(_ url: URL) {
        open(url)
    }
}
