import Foundation
import PicaProtocol

/// Bookkeeping for `events(sessionId:afterSeq:)` streams: which engine subscription feeds which stream,
/// and the last `seq` each stream delivered, which is where it resumes after a reconnect.
struct EventSubscriptions {
    struct Subscription {
        let sessionId: Id
        var lastSeq: Seq
        /// The engine's `subscriptionId` on the current connection; nil until `events.subscribe` answers.
        var remoteId: Id?
        let continuation: AsyncThrowingStream<SessionEvent, any Error>.Continuation
    }

    private(set) var byLocal: [UUID: Subscription] = [:]
    private var localByRemote: [Id: UUID] = [:]
    private var subscribing: Set<UUID> = []
    /// Events for a subscription id not yet returned by `events.subscribe`. The engine replays the log before it
    /// answers, so a stream's first events arrive ahead of the answer that names their subscription.
    private var held: [Id: [(seq: Seq, line: Data)]] = [:]

    mutating func add(
        _ local: UUID, sessionId: Id, afterSeq: Seq,
        continuation: AsyncThrowingStream<SessionEvent, any Error>.Continuation
    ) {
        byLocal[local] = Subscription(sessionId: sessionId, lastSeq: afterSeq, continuation: continuation)
    }

    mutating func remove(_ local: UUID) -> Subscription? {
        guard let subscription = byLocal.removeValue(forKey: local) else { return nil }
        if let remote = subscription.remoteId {
            localByRemote[remote] = nil
        }
        return subscription
    }

    /// False when the stream already has an engine subscription or one is being requested.
    mutating func beginSubscribing(_ local: UUID) -> Bool {
        guard let subscription = byLocal[local], subscription.remoteId == nil, !subscribing.contains(local) else {
            return false
        }
        subscribing.insert(local)
        return true
    }

    mutating func endSubscribing(_ local: UUID) {
        subscribing.remove(local)
        if subscribing.isEmpty {
            held = [:]
        }
    }

    func local(forRemote remote: Id) -> UUID? {
        localByRemote[remote]
    }

    mutating func hold(seq: Seq, line: Data, forRemote remote: Id) {
        guard !subscribing.isEmpty else { return }
        held[remote, default: []].append((seq, line))
    }

    /// Links `remote` to the stream and returns the events that arrived for it before the link existed.
    mutating func claim(_ local: UUID, remote: Id) -> [(seq: Seq, line: Data)] {
        byLocal[local]?.remoteId = remote
        localByRemote[remote] = local
        return held.removeValue(forKey: remote) ?? []
    }

    /// Records `seq` as delivered. False for a `seq` at or below the last one delivered: a duplicate from a replay.
    mutating func accept(_ seq: Seq, for local: UUID) -> Bool {
        guard let lastSeq = byLocal[local]?.lastSeq, seq > lastSeq else { return false }
        byLocal[local]?.lastSeq = seq
        return true
    }

    mutating func connectionLost() {
        localByRemote = [:]
        held = [:]
        subscribing = []
        for local in byLocal.keys {
            byLocal[local]?.remoteId = nil
        }
    }

    mutating func finish(_ local: UUID, throwing error: (any Error)?) {
        remove(local)?.continuation.finish(throwing: error)
    }

    mutating func finishAll(throwing error: (any Error)?) {
        for local in byLocal.keys {
            finish(local, throwing: error)
        }
    }
}
