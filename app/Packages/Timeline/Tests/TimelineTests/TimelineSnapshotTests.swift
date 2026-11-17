import DesignSystem
import DesignSystemTestSupport
import PicaProtocol
import SwiftUI
import Testing
@testable import Timeline

/// PLAN.md A-05: a snapshot of the timeline for each event type. Each fixture is folded by `TimelineStore` and drawn
/// with the rows and header the app uses, laid out in a stack because `ImageRenderer` cannot draw a `List`.
@MainActor
@Suite struct TimelineSnapshotTests {
    private let location = SnapshotLocation(testFile: #filePath)

    @Test func everyProtocolEventTypeHasASnapshot() throws {
        #expect(try EventFixtures.protocolEventTypes() == Set(EventFixtures.byType.keys))
    }

    @Test(arguments: EventFixtures.byType.keys.sorted())
    func eventTypeMatchesReference(_ type: String) throws {
        let fixture = try #require(EventFixtures.byType[type])
        let store = Self.store(EventFixtures.events(fixture.events), expanding: fixture.expand)
        Snapshot.assertMatchesReference(Self.render(store, .light), named: "event-\(type)", in: location)
    }

    @Test func anEventFromANewerEngineMatchesReference() {
        let store = Self.store(EventFixtures.events(EventFixtures.newerEngine), expanding: [])
        Snapshot.assertMatchesReference(Self.render(store, .light), named: "event-unknown", in: location)
    }

    @Test(arguments: [Appearance.dark, .lightIncreasedContrast, .darkIncreasedContrast])
    func aWholeTurnMatchesReferenceInEachAppearance(_ appearance: Appearance) throws {
        let types = ["assistant.message", "tool.completed", "subagent.completed", "policy.decision", "approval.resolved"]
        var events: [SessionEvent] = []
        var expand: Set<String> = []
        for type in types {
            let fixture = try #require(EventFixtures.byType[type])
            events += EventFixtures.events(fixture.events)
            expand.formUnion(fixture.expand)
        }
        // Each fixture numbers its events from 1; renumber them so the store applies them all.
        let renumbered = events.enumerated().map { index, event in event.withSeq(index + 1) }
        let store = Self.store(renumbered, expanding: expand)
        Snapshot.assertMatchesReference(Self.render(store, appearance), named: "turn-\(appearance.snapshotName)", in: location)
    }

    static func store(_ events: [SessionEvent], expanding expand: Set<String>) -> TimelineStore {
        let store = TimelineStore(sessionId: EventFixtures.sessionId, historySeq: 0)
        store.apply(contentsOf: events)
        for entry in store.entries {
            switch entry {
            case .tool(let item): item.isExpanded = expand.contains(item.id)
            case .subagent(let item): item.isExpanded = expand.contains(item.id)
            case .notice(let item): item.isExpanded = expand.contains(item.id)
            case .user, .assistant, .policy, .approval: break
            }
        }
        return store
    }

    static func render(_ store: TimelineStore, _ appearance: Appearance) -> Bitmap {
        Snapshot.render(
            TimelineSnapshotContent(store: store).environment(\._accessibilityReduceMotion, true),
            width: 640, appearance: appearance)
    }
}

/// The header and the rows in a stack, as the list lays them out.
private struct TimelineSnapshotContent: View {
    let store: TimelineStore

    var body: some View {
        VStack(spacing: 0) {
            TimelineHeader(store: store, title: "Route reads by size")
            VStack(spacing: Spacing.small) {
                ForEach(store.entries) { entry in
                    TimelineRow(entry: entry)
                }
            }
            .padding(Spacing.large)
        }
    }
}

extension SessionEvent {
    func withSeq(_ seq: Seq) -> SessionEvent {
        let encoder = JSONEncoder()
        var object = try! JSONSerialization.jsonObject(with: encoder.encode(self)) as! [String: Any]
        object["seq"] = seq
        return try! JSONDecoder().decode(SessionEvent.self, from: JSONSerialization.data(withJSONObject: object))
    }
}
