import EngineClient
import PicaProtocol
import SwiftUI

/// A session's timeline fed by the engine: it owns the session's `TimelineStore` and follows the session's events
/// while it is on screen. Give it `.id(sessionId)`, so another session gets a store of its own.
public struct SessionTimelineScreen: View {
    @State private var store: TimelineStore
    private let title: String
    private let client: EngineClient
    private let usageChip: UsageChipView?
    private let titleActions: TimelineTitleActions?

    /// `historySeq` is the session's `lastSeq` as last reported; the timeline shows a loading state until it has
    /// applied that many events. `usageChip` draws the header's usage chip from the summed events (A-11's, from the app
    /// target); without it the header shows a plain one. `titleActions` makes the title renameable.
    public init(
        sessionId: Id, title: String, historySeq: Seq, client: EngineClient, usageChip: UsageChipView? = nil,
        titleActions: TimelineTitleActions? = nil
    ) {
        _store = State(initialValue: TimelineStore(sessionId: sessionId, historySeq: historySeq))
        self.title = title
        self.client = client
        self.usageChip = usageChip
        self.titleActions = titleActions
    }

    public var body: some View {
        SessionTimelineView(store: store, title: title, usageChip: usageChip, titleActions: titleActions)
            .environment(\.resolveApproval, .engine(client))
            .task {
                let events = await client.events(sessionId: store.sessionId, afterSeq: store.lastSeq)
                await store.follow(events)
            }
    }
}
