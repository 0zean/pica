// S-07 spike client: connects to the spike server, decodes every NDJSON line with Codable,
// and measures write-to-decoded latency against the server's send timestamp.
// Node's process.hrtime and CLOCK_UPTIME_RAW both read mach_absolute_time, so the two
// processes share one monotonic clock; the start handshake measures the offset to prove it.
import Foundation

struct Summary: Encodable {
    let label: String
    let requested: Int
    let rate: Int
    let received: Int
    let inOrder: Bool
    let gaps: Int
    let outOfOrder: Int
    let serverSent: Int
    let serverSeconds: Double
    let receiveSeconds: Double
    let eventsPerSecond: Double
    let clockOffsetNs: Int64
    let handshakeRoundTripNs: Int64
    let latencyMs: [String: Double]
}

func monotonicNs() -> Int64 {
    Int64(clock_gettime_nsec_np(CLOCK_UPTIME_RAW))
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("client: \(message)\n".utf8))
    exit(1)
}

func connectUnix(_ path: String) -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { fail("socket() failed: errno \(errno)") }
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < capacity else { fail("socket path too long: \(path)") }
    withUnsafeMutableBytes(of: &address.sun_path) { raw in
        raw.copyBytes(from: path.utf8)
        raw[path.utf8.count] = 0
    }
    let length = socklen_t(MemoryLayout<sockaddr_un>.size)
    for _ in 0..<200 {
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, length) }
        }
        if result == 0 { return fd }
        usleep(10_000)
    }
    fail("could not connect to \(path): errno \(errno)")
}

func writeAll(_ fd: Int32, _ data: Data) {
    data.withUnsafeBytes { raw in
        var offset = 0
        while offset < raw.count {
            let written = write(fd, raw.baseAddress! + offset, raw.count - offset)
            guard written > 0 else { fail("write failed: errno \(errno)") }
            offset += written
        }
    }
}

/// Reads newline-delimited frames from a file descriptor, calling `handle` for each line.
final class LineReader {
    private let fd: Int32
    private var pending = [UInt8]()
    private var chunk = [UInt8](repeating: 0, count: 64 * 1024)

    init(fd: Int32) { self.fd = fd }

    /// Hands each complete line to `handle` until it returns false, reading from the socket
    /// only when no complete line is buffered. Returns false at end of stream.
    func readLines(_ handle: (ArraySlice<UInt8>) -> Bool) -> Bool {
        if pending.firstIndex(of: 0x0A) == nil {
            let count = chunk.withUnsafeMutableBytes { read(fd, $0.baseAddress!, $0.count) }
            if count < 0 { fail("read failed: errno \(errno)") }
            if count == 0 { return false }
            pending.append(contentsOf: chunk[0..<count])
        }
        var start = pending.startIndex
        var keepGoing = true
        while keepGoing, let newline = pending[start...].firstIndex(of: 0x0A) {
            keepGoing = handle(pending[start..<newline])
            start = newline + 1
        }
        pending.removeSubrange(pending.startIndex..<start)
        return true
    }
}

func percentile(_ sorted: [Int64], _ p: Double) -> Double {
    guard !sorted.isEmpty else { return .nan }
    let index = min(sorted.count - 1, Int((Double(sorted.count) * p).rounded(.up)) - 1)
    return Double(sorted[max(0, index)]) / 1e6
}

let arguments = CommandLine.arguments
guard arguments.count == 5, let count = Int(arguments[2]), let rate = Int(arguments[3]) else {
    fail("usage: S07Client <socket path> <count> <rate per second, 0 = unpaced> <label>")
}
let socketPath = arguments[1]
let label = arguments[4]

let fd = connectUnix(socketPath)
let reader = LineReader(fd: fd)
let decoder = JSONDecoder()

let request = try JSONEncoder().encode(StartRequest(params: .init(count: count, rate: rate)))
let handshakeStart = monotonicNs()
writeAll(fd, request + Data([0x0A]))

var serverNs: Int64?
while serverNs == nil {
    let open = reader.readLines { line in
        guard let response = try? decoder.decode(StartResponse.self, from: Data(line)) else {
            fail("bad start response")
        }
        serverNs = Int64(response.result.serverNs)
        return false
    }
    if !open && serverNs == nil { fail("connection closed before start response") }
}
let handshakeEnd = monotonicNs()
let roundTrip = handshakeEnd - handshakeStart
let clockOffset = serverNs! - (handshakeStart + roundTrip / 2)

var latencies = [Int64]()
latencies.reserveCapacity(count)
var lastSeq = 0
var gaps = 0
var outOfOrder = 0
var firstReceive: Int64 = 0
var lastReceive: Int64 = 0
var done: DoneParams?

while done == nil {
    let open = reader.readLines { line in
        let notification: Notification
        do {
            notification = try decoder.decode(Notification.self, from: Data(line))
        } catch {
            fail("decode failed: \(error)")
        }
        let decodedAt = monotonicNs()
        switch notification {
        case .event(let event):
            guard let sent = Int64(event.sentNs) else { fail("bad sentNs \(event.sentNs)") }
            latencies.append(decodedAt - sent)
            if latencies.count == 1 { firstReceive = decodedAt }
            lastReceive = decodedAt
            if event.seq > lastSeq + 1 { gaps += event.seq - lastSeq - 1 }
            if event.seq <= lastSeq { outOfOrder += 1 }
            lastSeq = max(lastSeq, event.seq)
        case .done(let params):
            done = params
            return false
        }
        return true
    }
    if !open && done == nil { fail("connection closed after \(latencies.count) events without spike.done") }
}
close(fd)

let sorted = latencies.sorted()
let receiveSeconds = Double(lastReceive - firstReceive) / 1e9
let summary = Summary(
    label: label,
    requested: count,
    rate: rate,
    received: latencies.count,
    inOrder: gaps == 0 && outOfOrder == 0 && lastSeq == count,
    gaps: gaps,
    outOfOrder: outOfOrder,
    serverSent: done!.sent,
    serverSeconds: done!.seconds,
    receiveSeconds: receiveSeconds,
    eventsPerSecond: receiveSeconds > 0 ? Double(latencies.count - 1) / receiveSeconds : 0,
    clockOffsetNs: clockOffset,
    handshakeRoundTripNs: roundTrip,
    latencyMs: [
        "p50": percentile(sorted, 0.50),
        "p90": percentile(sorted, 0.90),
        "p99": percentile(sorted, 0.99),
        "p999": percentile(sorted, 0.999),
        "max": percentile(sorted, 1.0),
    ]
)
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
print(String(decoding: try encoder.encode(summary), as: UTF8.self))
