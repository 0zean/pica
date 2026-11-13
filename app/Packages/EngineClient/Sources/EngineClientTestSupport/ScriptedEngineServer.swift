import Darwin
import EngineClient
import Foundation
import PicaProtocol

/// A Unix-socket server that plays the engine's side of a test script, one accepted connection at a time.
public actor ScriptedEngineServer {
    public nonisolated let socketPath: String
    private var listener: Listener?
    private var accepted: AsyncStream<Int32>.AsyncIterator?
    private var acceptedContinuation: AsyncStream<Int32>.Continuation

    public init() throws {
        let directory = FileManager.default.temporaryDirectory.path
        socketPath = "\(directory)/pica-\(UUID().uuidString.prefix(8)).sock"
        let (stream, continuation) = AsyncStream<Int32>.makeStream()
        accepted = stream.makeAsyncIterator()
        acceptedContinuation = continuation
        listener = try Listener(path: socketPath, continuation: acceptedContinuation)
    }

    /// Waits for the client's next connection.
    public func nextPeer() async throws -> ScriptedPeer {
        guard var iterator = accepted else { throw ScriptError.unexpected("nextPeer() called concurrently") }
        accepted = nil
        let fd = await iterator.next(isolation: self)
        accepted = iterator
        guard let fd else { throw ScriptError.serverStopped }
        return ScriptedPeer(connection: UnixSocketConnection(adopting: fd, maxFrameBytes: 8 * 1024 * 1024))
    }

    /// Closes the listening socket and removes its path, so connection attempts fail until `startListening()`.
    public func stopListening() {
        listener?.stop()
        listener = nil
    }

    public func startListening() throws {
        guard listener == nil else { return }
        listener = try Listener(path: socketPath, continuation: acceptedContinuation)
    }

    public func stop() {
        stopListening()
        acceptedContinuation.finish()
    }
}

/// A listening socket whose accepted descriptors are yielded to a stream.
private final class Listener: Sendable {
    private let source: any DispatchSourceRead
    private let path: String

    init(path: String, continuation: AsyncStream<Int32>.Continuation) throws {
        unlink(path)
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw SocketError.systemCall("socket", errno) }
        var address = try SocketAddress(path: path)
        guard address.withSockaddr({ bind(fd, $0, $1) }) == 0, listen(fd, 8) == 0 else {
            let code = errno
            close(fd)
            throw SocketError.systemCall("bind", code)
        }
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: DispatchQueue(label: "ScriptedEngineServer"))
        source.setEventHandler {
            let client = accept(fd, nil, nil)
            if client >= 0 {
                continuation.yield(client)
            }
        }
        source.setCancelHandler {
            close(fd)
        }
        source.resume()
        self.source = source
        self.path = path
    }

    /// Removes the path at once, so the next connection attempt fails instead of waiting in the closing socket's backlog.
    func stop() {
        unlink(path)
        source.cancel()
    }
}

public enum ScriptError: Error, Equatable {
    case serverStopped
    case peerClosed
    case unexpected(String)
}
