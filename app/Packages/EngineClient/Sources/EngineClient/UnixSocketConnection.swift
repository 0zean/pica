import Darwin
import Foundation
import Synchronization

/// One NDJSON connection over a Unix domain socket (D-04; framing and buffer size from S-07).
///
/// A dedicated thread reads with `read(2)` into a 64 KB buffer and yields complete lines on `lines`.
/// Writes go through a serial queue, so a peer that stops reading never blocks the caller.
/// `lines` finishes when the peer closes the socket, an I/O call fails, or `close()` is called.
public final class UnixSocketConnection: Sendable {
    public let lines: AsyncThrowingStream<Data, any Error>
    private let fd: Int32
    private let writer = DispatchQueue(label: "dev.pica.EngineClient.socket-writer")
    /// True once `fd` is closed; guards `shutdown` against a descriptor number the system has reused.
    private let descriptorClosed = Mutex(false)

    public static func connect(to path: String, maxFrameBytes: Int) throws(SocketError) -> UnixSocketConnection {
        var address = try SocketAddress(path: path)
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw .systemCall("socket", errno) }
        let result = address.withSockaddr { Darwin.connect(fd, $0, $1) }
        guard result == 0 else {
            let code = errno
            Darwin.close(fd)
            throw .systemCall("connect", code)
        }
        return UnixSocketConnection(adopting: fd, maxFrameBytes: maxFrameBytes)
    }

    /// Takes ownership of a connected socket descriptor.
    public init(adopting fd: Int32, maxFrameBytes: Int) {
        var noSigPipe: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
        self.fd = fd
        let (lines, continuation) = AsyncThrowingStream<Data, any Error>.makeStream()
        self.lines = lines
        let thread = Thread { [self] in
            readLoop(maxFrameBytes: maxFrameBytes, into: continuation)
        }
        thread.name = "dev.pica.EngineClient.socket-reader"
        thread.qualityOfService = .userInitiated
        thread.start()
    }

    /// Queues `frame` for writing. A write failure shuts the socket down, which ends `lines`.
    public func send(_ frame: Data) {
        writer.async { [self] in
            if descriptorClosed.withLock({ $0 }) { return }
            if !writeAll(frame) {
                shutdownSocket()
            }
        }
    }

    public func close() {
        shutdownSocket()
    }

    private func readLoop(maxFrameBytes: Int, into continuation: AsyncThrowingStream<Data, any Error>.Continuation) {
        var splitter = LineSplitter(maxFrameBytes: maxFrameBytes)
        let buffer = UnsafeMutableRawBufferPointer.allocate(byteCount: 64 * 1024, alignment: 1)
        defer { buffer.deallocate() }
        var failure: (any Error)?
        while true {
            let count = read(fd, buffer.baseAddress, buffer.count)
            if count > 0 {
                do {
                    for line in try splitter.push(UnsafeRawBufferPointer(rebasing: buffer[0..<count])) {
                        continuation.yield(line)
                    }
                } catch {
                    failure = error
                    break
                }
            } else if count == 0 {
                break
            } else if errno != EINTR {
                failure = SocketError.systemCall("read", errno)
                break
            }
        }
        shutdownSocket()
        writer.async { [self] in
            descriptorClosed.withLock { closed in
                closed = true
                Darwin.close(fd)
            }
        }
        continuation.finish(throwing: failure)
    }

    private func writeAll(_ frame: Data) -> Bool {
        frame.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let written = write(fd, bytes.baseAddress! + offset, bytes.count - offset)
                if written > 0 {
                    offset += written
                } else if written < 0 && errno == EINTR {
                    continue
                } else {
                    return false
                }
            }
            return true
        }
    }

    private func shutdownSocket() {
        descriptorClosed.withLock { closed in
            if !closed {
                shutdown(fd, SHUT_RDWR)
            }
        }
    }
}

public enum SocketError: Error, Equatable, Sendable {
    case pathTooLong(String)
    case systemCall(String, Int32)
}

/// A `sockaddr_un` for a filesystem path.
public struct SocketAddress {
    private var storage = sockaddr_un()

    public init(path: String) throws(SocketError) {
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: storage.sun_path) else { throw .pathTooLong(path) }
        storage.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &storage.sun_path) { $0.copyBytes(from: bytes) }
    }

    public mutating func withSockaddr<Result>(_ body: (UnsafePointer<sockaddr>, socklen_t) -> Result) -> Result {
        let length = socklen_t(MemoryLayout<sockaddr_un>.size)
        return withUnsafePointer(to: &storage) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { body($0, length) }
        }
    }
}
