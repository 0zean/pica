import DesignSystem
import Foundation

/// The themes a user can choose: the built-in one, then each valid file in `themes/` (docs/themes.md).
public struct ThemeLibrary: Equatable, Sendable {
    /// A theme file that could not be used, and why.
    public struct Problem: Equatable, Sendable, Identifiable {
        public let file: String
        public let message: String
        public var id: String { file }
    }

    public let themes: [Theme]
    public let problems: [Problem]

    public static let builtIn = ThemeLibrary(themes: [.pica], problems: [])

    /// `~/Library/Application Support/Pica/themes`, under `PICA_TEST_HOME` when the UI tests set one, as the engine's
    /// data directory is.
    public static func directory(environment: [String: String]) -> URL {
        let home = environment["PICA_TEST_HOME"].map { URL(filePath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser
        return home.appending(path: "Library/Application Support/Pica/themes")
    }

    /// Reads every `.jsonc` file in `directory`. A missing directory is no themes, not a problem.
    public static func load(from directory: URL) -> ThemeLibrary {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        var themes: [Theme] = []
        var problems: [Problem] = []
        for file in files.filter({ $0.pathExtension == ThemeFile.fileExtension }).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let id = file.deletingPathExtension().lastPathComponent
            guard isValidId(id) else {
                problems.append(Problem(file: file.lastPathComponent, message: "A theme's file name may use letters, digits, . _ and -, and not start with one of . _ -."))
                continue
            }
            guard id != Theme.pica.id else {
                problems.append(Problem(file: file.lastPathComponent, message: "“pica” is the built-in theme's name."))
                continue
            }
            do {
                themes.append(try ThemeFile.parse(Data(contentsOf: file), id: id))
            } catch let error as ThemeFileError {
                problems.append(Problem(file: file.lastPathComponent, message: error.description))
            } catch {
                problems.append(Problem(file: file.lastPathComponent, message: error.localizedDescription))
            }
        }
        themes.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        return ThemeLibrary(themes: [.pica] + themes, problems: problems)
    }

    /// The same rule as config.jsonc's `appearance.theme`.
    static func isValidId(_ id: String) -> Bool {
        guard let first = id.unicodeScalars.first, CharacterSet.alphanumerics.contains(first), first.isASCII else { return false }
        return id.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || "._-".unicodeScalars.contains($0)) }
    }

    public func theme(id: String) -> Theme? {
        themes.first { $0.id == id }
    }
}
