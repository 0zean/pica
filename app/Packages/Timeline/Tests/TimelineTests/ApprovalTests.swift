import DesignSystem
import DesignSystemTestSupport
import PicaProtocol
import SwiftUI
import Synchronization
import Testing
@testable import Timeline

/// A-07: approval cards name the call they are for, send the user's choice, and show it once the engine reports it.
@MainActor
@Suite struct ApprovalTests {
    private let location = SnapshotLocation(testFile: #filePath)

    static let shellStarted = (
        "tool.started",
        #"{"toolCallId":"t-1","toolName":"bash","agent":"main","parentToolCallId":null,"arguments":{"command":"npm test","description":"Run npm test"}}"#
    )
    static let requested = (
        "approval.requested",
        #"{"id":"a-1","sessionId":"s-1","kind":"tool_call","toolCallId":"t-1","summary":"bash wants to run npm test"}"#
    )

    private func approval(_ items: [(String, String)]) throws -> (TimelineStore, ApprovalItem) {
        let store = TimelineStore(sessionId: EventFixtures.sessionId, historySeq: 0)
        store.apply(contentsOf: EventFixtures.events(items))
        for entry in store.entries {
            if case .approval(let item) = entry { return (store, item) }
        }
        throw ApprovalTestError.noApproval
    }

    @Test func aCardNamesItsToolAndTheArgumentARuleWouldMatch() throws {
        let (_, item) = try approval([Self.shellStarted, Self.requested])
        #expect(item.toolName == "bash")
        #expect(item.subject == "npm test")
        #expect(item.choice == nil)
    }

    @Test func aCardWithoutItsCallInTheTimelineHasNoTool() throws {
        let (_, item) = try approval([Self.requested])
        #expect(item.toolName == nil)
        #expect(item.subject == nil)
    }

    @Test(arguments: ApprovalChoice.allCases)
    func aChoiceIsSentAndShownWhenTheEngineResolvesIt(_ choice: ApprovalChoice) async throws {
        let (store, item) = try approval([Self.shellStarted, Self.requested])
        let sent = Mutex<[ApprovalChoice]>([])
        await item.resolve(choice, with: ResolveApprovalAction { id, choice in
            #expect(id == "a-1")
            sent.withLock { $0.append(choice) }
        })
        #expect(sent.withLock { $0 } == [choice])
        #expect(item.isResolving)
        #expect(item.choice == nil)
        store.apply(contentsOf: [
            EventFixtures.events([("approval.resolved", #"{"approvalId":"a-1","choice":"\#(choice.rawValue)"}"#)])[0].withSeq(3)
        ])
        #expect(item.choice == choice)
        #expect(!item.isResolving)
        // A resolved card sends nothing more.
        await item.resolve(.deny, with: ResolveApprovalAction { _, _ in Issue.record("sent after resolution") })
    }

    @Test func aRefusedChoiceLeavesTheCardPendingWithTheReason() async throws {
        let (_, item) = try approval([Self.shellStarted, Self.requested])
        await item.resolve(.allowAlways, with: ResolveApprovalAction { _, _ in throw ApprovalTestError.refused })
        #expect(item.choice == nil)
        #expect(!item.isResolving)
        #expect(item.failure != nil)
    }

    @Test(arguments: [Appearance.light, .dark])
    func aPendingCardMatchesReference(_ appearance: Appearance) throws {
        let (store, _) = try approval([Self.shellStarted, Self.requested])
        let view = VStack(spacing: Spacing.small) {
            ForEach(store.entries) { TimelineRow(entry: $0) }
        }
        .padding(Spacing.large)
        .environment(\.resolveApproval, ResolveApprovalAction { _, _ in })
        .environment(\._accessibilityReduceMotion, true)
        Snapshot.assertMatchesReference(
            Snapshot.render(view, width: 640, appearance: appearance), named: "approval-pending-\(appearance.snapshotName)",
            in: location)
    }
}

private enum ApprovalTestError: Error, CustomStringConvertible {
    case noApproval
    case refused

    var description: String {
        switch self {
        case .noApproval: "no approval row"
        case .refused: "the permission rule was not saved"
        }
    }
}
