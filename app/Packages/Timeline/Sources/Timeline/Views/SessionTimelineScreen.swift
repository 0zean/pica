import EngineClient
import PicaProtocol
import SwiftUI

/// A session's timeline fed by the engine: it owns the session's `TimelineStore` and follows the session's events
/// while it is on screen. Give it `.id(sessionId)`, so another session gets a store of its own.
public struct SessionTimelineScreen: View {
    @State private var store: TimelineStore
    private let title: String
    private let client: EngineClient

    /// `historySeq` is the session's `lastSeq` as last reported; the timeline shows a loading state until it has
    /// applied that many events.
    public init(sessionId: Id, title: String, historySeq: Seq, client: EngineClient) {
        _store = State(initialValue: TimelineStore(sessionId: sessionId, historySeq: historySeq))
        self.title = title
        self.client = client
    }

    public var body: some View {
        SessionTimelineView(store: store, title: title)
            .task {
                let events = await client.events(sessionId: store.sessionId, afterSeq: store.lastSeq)
                await store.follow(events)
            }
    }
}
