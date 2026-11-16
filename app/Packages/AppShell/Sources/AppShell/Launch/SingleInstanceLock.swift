import Darwin
import Foundation

/// An exclusive `flock` on a file, held for the life of the app. A second copy of Pica cannot take it, even one
/// started with `open -n`. The kernel drops the lock when the process exits, so a crash leaves nothing stale.
public final class SingleInstanceLock: Sendable {
    private let descriptor: Int32

    private init(descriptor: Int32) {
        self.descriptor = descriptor
    }

    /// Takes the lock, or returns nil when another process holds it.
    public static func acquire(at url: URL) throws -> SingleInstanceLock? {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let descriptor = open(url.path, O_RDWR | O_CREAT | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            let code = errno
            close(descriptor)
            if code == EWOULDBLOCK { return nil }
            throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
        }
        return SingleInstanceLock(descriptor: descriptor)
    }

    deinit {
        close(descriptor)
    }
}
