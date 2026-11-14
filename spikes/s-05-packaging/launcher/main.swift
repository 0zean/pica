// S-05 launcher: the app's main executable. Starts the bundled Node with the hello engine (as A-01
// will supervise the real one), waits for the ready line, then pings it over the Unix socket.
// Writes the result to ~/Library/Logs/PicaS05/last-run.json and, unless --headless, shows it.
import AppKit
import Darwin
import Foundation

struct Failure: Error { let message: String }

let headless = CommandLine.arguments.contains("--headless")
let contents = Bundle.main.bundleURL.appendingPathComponent("Contents")
let nodeURL = contents.appendingPathComponent("Helpers/node")
let engineURL = contents.appendingPathComponent("Resources/engine/hello-engine.mjs")
let copilotURL = contents.appendingPathComponent("Resources/copilot/prebuilds/darwin-arm64/copilot-runtime")
// sun_path holds 104 bytes; the per-user temporary directory keeps the path well under that.
let socketPath = FileManager.default.temporaryDirectory.appendingPathComponent("pica-s05-\(getpid()).sock").path

func startEngine() throws -> (Process, FileHandle) {
    let process = Process()
    process.executableURL = nodeURL
    process.arguments = ["--disable-warning=ExperimentalWarning", engineURL.path, "--socket", socketPath]
    var environment = ProcessInfo.processInfo.environment
    environment["COPILOT_CLI_PATH"] = copilotURL.path
    process.environment = environment
    let stdout = Pipe()
    process.standardOutput = stdout
    try process.run()
    return (process, stdout.fileHandleForReading)
}

func readLine(_ handle: FileHandle) throws -> String {
    var bytes = Data()
    while true {
        let byte = handle.readData(ofLength: 1)
        if byte.isEmpty { throw Failure(message: "engine exited before printing its ready line") }
        if byte.first == 0x0A { return String(decoding: bytes, as: UTF8.self) }
        bytes.append(byte)
    }
}

final class Connection {
    private let fd: Int32
    private var buffer = Data()
    private var nextId = 1

    init(path: String) throws {
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &address.sun_path) { raw in
            raw.copyBytes(from: Array(path.utf8.prefix(raw.count - 1)))
        }
        let length = socklen_t(MemoryLayout<sockaddr_un>.size)
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, length) }
        }
        if result != 0 { throw Failure(message: "connect failed: errno \(errno)") }
    }

    deinit { close(fd) }

    func call(_ method: String, _ params: [String: Any] = [:]) throws -> [String: Any] {
        let request: [String: Any] = ["jsonrpc": "2.0", "id": nextId, "method": method, "params": params]
        nextId += 1
        var line = try JSONSerialization.data(withJSONObject: request)
        line.append(0x0A)
        _ = line.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
        let reply = try JSONSerialization.jsonObject(with: try readFrame()) as? [String: Any] ?? [:]
        if let error = reply["error"] { throw Failure(message: "\(method) failed: \(error)") }
        return reply["result"] as? [String: Any] ?? [:]
    }

    private func readFrame() throws -> Data {
        var chunk = [UInt8](repeating: 0, count: 65536)
        while true {
            if let newline = buffer.firstIndex(of: 0x0A) {
                let frame = buffer[buffer.startIndex..<newline]
                buffer = Data(buffer[buffer.index(after: newline)...])
                return Data(frame)
            }
            let count = read(fd, &chunk, chunk.count)
            if count <= 0 { throw Failure(message: "engine closed the socket") }
            buffer.append(contentsOf: chunk[0..<count])
        }
    }
}

func ping() throws -> [String: Any] {
    let (engine, stdout) = try startEngine()
    defer { engine.terminate() }
    let ready = try readLine(stdout)
    guard ready.contains("\"ready\":true") else { throw Failure(message: "unexpected ready line: \(ready)") }
    let connection = try Connection(path: socketPath)
    let hello = try connection.call("engine.hello", [
        "protocolVersion": ["major": 1, "minor": 0],
        "client": ["name": "pica-s05", "version": "0.0.0"],
    ])
    let health = try connection.call("engine.health")
    let probe = try connection.call("spike.probe")
    let copilotOk = (probe["copilot"] as? [String: Any])?["ok"] as? Bool ?? false
    let sqliteOk = (probe["sqlite"] as? [String: Any])?["ok"] as? Bool ?? false
    return [
        "ok": health["status"] as? String == "ok" && copilotOk && sqliteOk,
        "hello": hello, "health": health, "probe": probe,
    ]
}

var result: [String: Any]
do {
    result = try ping()
} catch {
    result = ["ok": false, "error": (error as? Failure)?.message ?? "\(error)"]
}
result["bundle"] = Bundle.main.bundlePath
result["at"] = ISO8601DateFormatter().string(from: Date())

let json = (try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])) ?? Data()
let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/PicaS05")
try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
try? json.write(to: logs.appendingPathComponent("last-run.json"))
FileHandle.standardOutput.write(json)
FileHandle.standardOutput.write(Data("\n".utf8))

let ok = result["ok"] as? Bool ?? false
if !headless {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    app.activate()
    let alert = NSAlert()
    alert.messageText = ok ? "Engine answered the ping" : "Engine did not answer"
    alert.informativeText = String(decoding: json, as: UTF8.self)
    alert.alertStyle = ok ? .informational : .critical
    alert.runModal()
}
exit(ok ? 0 : 1)
