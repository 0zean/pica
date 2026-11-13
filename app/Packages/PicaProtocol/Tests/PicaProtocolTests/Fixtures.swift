import Foundation
import PicaProtocol

/// The shared protocol fixtures in `fixtures/protocol/`, which the engine's tests validate against the zod schemas.
enum Fixtures {
    static let root = URL(filePath: #filePath)
        .deletingLastPathComponent()  // PicaProtocolTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // PicaProtocol
        .deletingLastPathComponent()  // Packages
        .deletingLastPathComponent()  // app
        .deletingLastPathComponent()
        .appending(path: "fixtures/protocol")

    /// Paths relative to `root`, sorted, e.g. `events/tool.started.json`.
    static let all: [String] = {
        let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey])
        let files = (enumerator?.allObjects as? [URL] ?? []).filter { $0.pathExtension == "json" }
        let depth = root.standardizedFileURL.pathComponents.count
        return files.map { $0.standardizedFileURL.pathComponents.dropFirst(depth).joined(separator: "/") }.sorted()
    }()

    static func data(_ relativePath: String) throws -> Data {
        try Data(contentsOf: root.appending(path: relativePath))
    }
}

/// Decodes `data` as `Value`, encodes it again, and returns both sides as JSON values for comparison.
func roundTrip<Value: Codable>(_ type: Value.Type, _ data: Data) throws -> (original: JSONValue, reencoded: JSONValue, value: Value) {
    let decoder = JSONDecoder()
    let value = try decoder.decode(Value.self, from: data)
    let reencoded = try JSONEncoder().encode(value)
    return (try decoder.decode(JSONValue.self, from: data), try decoder.decode(JSONValue.self, from: reencoded), value)
}
