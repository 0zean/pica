import Foundation

/// Splits an NDJSON byte stream into lines, as the engine's `NdjsonDecoder` does.
/// Empty lines are skipped. A line longer than `maxFrameBytes` is an error: the client treats it as a broken connection.
struct LineSplitter {
    let maxFrameBytes: Int
    private var partial = Data()

    init(maxFrameBytes: Int) {
        self.maxFrameBytes = maxFrameBytes
    }

    mutating func push(_ bytes: UnsafeRawBufferPointer) throws(FrameTooLarge) -> [Data] {
        var lines: [Data] = []
        var start = bytes.startIndex
        while start < bytes.endIndex {
            let newline = bytes[start...].firstIndex(of: 0x0A)
            let end = newline ?? bytes.endIndex
            guard partial.count + (end - start) <= maxFrameBytes else {
                throw FrameTooLarge(maxFrameBytes: maxFrameBytes)
            }
            partial.append(contentsOf: UnsafeRawBufferPointer(rebasing: bytes[start..<end]))
            guard newline != nil else { break }
            if !partial.isEmpty {
                lines.append(partial)
            }
            partial = Data()
            start = end + 1
        }
        return lines
    }
}

struct FrameTooLarge: Error, Equatable {
    let maxFrameBytes: Int
}
