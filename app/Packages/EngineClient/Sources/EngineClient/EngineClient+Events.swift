import Foundation
import PicaProtocol

struct NotificationListener {
    let deliver: (Data) -> Void
    let finish: () -> Void
}

extension EngineClient {
    /// The session's events after `afterSeq`: first those already in the engine's log, then live ones.
    /// After a reconnect the stream resumes after the last `seq` it delivered, with no gap and no duplicate.
    /// It finishes with an error if the engine refuses the subscription, and without one on `close()`.
    /// Ending iteration unsubscribes.
    public func events(sessionId: Id, afterSeq: Seq) -> AsyncThrowingStream<SessionEvent, any Error> {
        let (stream, continuation) = AsyncThrowingStream<SessionEvent, any Error>.makeStream()
        guard state != .closed else {
            continuation.finish(throwing: EngineClientError.closed)
            return stream
        }
        let local = UUID()
        subscriptions.add(local, sessionId: sessionId, afterSeq: afterSeq, continuation: continuation)
        continuation.onTermination = { _ in
            Task { await self.endSubscription(local) }
        }
        if connection != nil {
            Task { await self.subscribeOrFinish(local) }
        }
        return stream
    }

    /// Every notification named `Notification.name`. Session events come through `events(sessionId:afterSeq:)` instead.
    public func notifications<Notification: PicaNotification>(
        _ notification: Notification.Type
    ) -> AsyncStream<Notification.Params> {
        precondition(Notification.name != Notifications.EventsEvent.name, "use events(sessionId:afterSeq:)")
        let (stream, continuation) = AsyncStream<Notification.Params>.makeStream()
        guard state != .closed else {
            continuation.finish()
            return stream
        }
        let id = UUID()
        let name = Notification.name
        let decoder = self.decoder
        notificationListeners[name, default: [:]][id] = NotificationListener(
            deliver: { line in
                if let params = try? decoder.decode(ParamsEnvelope<Notification.Params>.self, from: line).params {
                    continuation.yield(params)
                }
            },
            finish: { continuation.finish() })
        continuation.onTermination = { _ in
            Task { await self.removeNotificationListener(name, id) }
        }
        return stream
    }

    func deliverNotification(method: String, header: IncomingHeader, line: Data) {
        guard method == Notifications.EventsEvent.name else {
            for listener in notificationListeners[method]?.values ?? [:].values {
                listener.deliver(line)
            }
            return
        }
        guard let remote = header.params?.subscriptionId, let seq = header.params?.event?.seq else { return }
        if let local = subscriptions.local(forRemote: remote) {
            deliver(seq: seq, line: line, to: local)
        } else {
            subscriptions.hold(seq: seq, line: line, forRemote: remote)
        }
    }

    /// Subscribes every open stream on a new connection. An engine error ends only that stream;
    /// losing the connection or timing out fails the whole reconnect attempt.
    func resubscribeAll() async throws {
        for local in subscriptions.byLocal.keys {
            do {
                try await subscribe(local)
            } catch let error as EngineClientError {
                guard case .engine = error else { throw error }
                subscriptions.finish(local, throwing: error)
            }
        }
    }

    private func subscribeOrFinish(_ local: UUID) async {
        do {
            try await subscribe(local)
        } catch let error as EngineClientError {
            switch error {
            case .engine, .timedOut, .malformedResponse:
                subscriptions.finish(local, throwing: error)
            default:
                // Lost or closed connection: a reconnect subscribes again.
                break
            }
        } catch {
            subscriptions.finish(local, throwing: error)
        }
    }

    private func subscribe(_ local: UUID) async throws {
        guard subscriptions.beginSubscribing(local), let subscription = subscriptions.byLocal[local] else { return }
        defer { subscriptions.endSubscribing(local) }
        let subscribedGeneration = generation
        let result = try await request(
            Methods.EventsSubscribe.self,
            EventsSubscribeParams(sessionId: subscription.sessionId, afterSeq: subscription.lastSeq))
        guard generation == subscribedGeneration, connection != nil else { return }
        guard subscriptions.byLocal[local] != nil else {
            unsubscribeRemote(result.subscriptionId)
            return
        }
        for event in subscriptions.claim(local, remote: result.subscriptionId) {
            deliver(seq: event.seq, line: event.line, to: local)
        }
    }

    private func deliver(seq: Seq, line: Data, to local: UUID) {
        guard subscriptions.accept(seq, for: local),
            let notification = try? decoder.decode(ParamsEnvelope<EventsEventNotification>.self, from: line)
        else { return }
        subscriptions.byLocal[local]?.continuation.yield(notification.params.event)
    }

    private func endSubscription(_ local: UUID) {
        guard let remote = subscriptions.remove(local)?.remoteId else { return }
        unsubscribeRemote(remote)
    }

    private func unsubscribeRemote(_ remote: Id) {
        guard connection != nil else { return }
        Task {
            _ = try? await request(Methods.EventsUnsubscribe.self, EventsUnsubscribeParams(subscriptionId: remote))
        }
    }

    private func removeNotificationListener(_ name: String, _ id: UUID) {
        notificationListeners[name]?[id] = nil
    }
}
