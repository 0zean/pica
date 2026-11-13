@testable import EngineClient
import Foundation
import Testing

@Suite(.timeLimit(.minutes(1))) struct LineSplitterTests {
    private func push(_ text: String, into splitter: inout LineSplitter) throws -> [String] {
        let bytes = Array(text.utf8)
        return try bytes.withUnsafeBytes { try splitter.push($0) }.map { String(decoding: $0, as: UTF8.self) }
    }

    @Test func joinsLinesSplitAcrossReads() throws {
        var splitter = LineSplitter(maxFrameBytes: 64)
        #expect(try push("{\"a\":1}\n{\"b\"", into: &splitter) == ["{\"a\":1}"])
        #expect(try push(":2}\n\n{\"c\":3}\n", into: &splitter) == ["{\"b\":2}", "{\"c\":3}"])
    }

    @Test func rejectsALineLongerThanTheLimit() throws {
        var splitter = LineSplitter(maxFrameBytes: 4)
        #expect(throws: FrameTooLarge(maxFrameBytes: 4)) { try push("12345", into: &splitter) }
    }
}
