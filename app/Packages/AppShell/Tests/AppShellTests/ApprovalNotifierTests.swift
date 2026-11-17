import AppShell
import PicaProtocol
import Testing

/// A-07: a session that starts waiting for approval gets one notification while Pica is in the background, none
/// while it is frontmost, and the notification is withdrawn once the session moves on.
@MainActor
@Suite struct ApprovalNotifierTests {
    private final class Recorder: ApprovalNotificationPosting {
        var posted: [ApprovalNotification] = []
        var removed: [Id] = []
        func post(_ notification: ApprovalNotification) { posted.append(notification) }
        func remove(sessionId: Id) { removed.append(sessionId) }
    }

    private func session(_ state: SessionState, id: String = "s-1", title: String = "Fix the router") -> Session {
        Session(
            id: id, workspaceId: "w", title: title, state: state, writeRoots: [], referenceRoots: [], routingProfile: .off,
            budgetCredits: nil, lastSeq: 0, createdAt: "2026-11-16T00:00:00Z", updatedAt: "2026-11-16T00:00:00Z")
    }

    private func notifier(_ recorder: Recorder, frontmost: Bool, summary: String? = "bash wants to run npm test") -> ApprovalNotifier {
        ApprovalNotifier(poster: recorder, isFrontmost: { frontmost }, pendingSummary: { _ in summary })
    }

    @Test func aSessionThatStartsWaitingIsNotifiedOnceWithItsRequest() async {
        let recorder = Recorder()
        let notifier = notifier(recorder, frontmost: false)
        await notifier.sessionChanged(session(.running))
        await notifier.sessionChanged(session(.awaitingApproval))
        await notifier.sessionChanged(session(.awaitingApproval))
        #expect(recorder.posted == [ApprovalNotification(
            sessionId: "s-1", title: "Approval needed", subtitle: "Fix the router", body: "bash wants to run npm test")])
    }

    @Test func nothingIsPostedWhilePicaIsFrontmost() async {
        let recorder = Recorder()
        let notifier = notifier(recorder, frontmost: true)
        await notifier.sessionChanged(session(.awaitingApproval))
        #expect(recorder.posted.isEmpty)
    }

    @Test func theNotificationIsWithdrawnWhenTheSessionMovesOn() async {
        let recorder = Recorder()
        let notifier = notifier(recorder, frontmost: false)
        await notifier.sessionChanged(session(.awaitingApproval))
        await notifier.sessionChanged(session(.running))
        #expect(recorder.removed == ["s-1"])
        await notifier.sessionChanged(session(.awaitingApproval))
        #expect(recorder.posted.count == 2)
    }

    @Test func otherStatesPostAndWithdrawNothing() async {
        let recorder = Recorder()
        let notifier = notifier(recorder, frontmost: false)
        for state in SessionState.allCases where state != .awaitingApproval {
            await notifier.sessionChanged(session(state))
        }
        #expect(recorder.posted.isEmpty)
        #expect(recorder.removed.isEmpty)
    }

    @Test func aRequestThatCannotBeReadStillNotifies() async {
        let recorder = Recorder()
        let notifier = notifier(recorder, frontmost: false, summary: nil)
        await notifier.sessionChanged(session(.awaitingApproval, title: ""))
        #expect(recorder.posted.first?.body == "A tool call is waiting for your approval.")
    }
}
