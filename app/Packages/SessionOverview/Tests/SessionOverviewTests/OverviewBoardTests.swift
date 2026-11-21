@testable import SessionOverview
import Foundation
import PicaProtocol
import Testing

func session(_ id: Id, _ state: SessionState, updated: String, workspace: Id = "w1") -> Session {
    Session(
        id: id, workspaceId: workspace, title: "Session \(id)", state: state, writeRoots: [], referenceRoots: [],
        routingProfile: .off, budgetCredits: nil, lastSeq: 0, createdAt: "2026-11-21T09:00:00.000Z",
        updatedAt: "2026-11-21T\(updated).000Z")
}

/// PLAN.md A-16: the board's order (docs/session-overview.md).
@Suite struct OverviewBoardTests {
    @Test func sessionsAwaitingApprovalComeFirstThenFailedOnesLongestWaitingFirst() {
        let board = OverviewBoard(sessions: [
            session("idle", .idle, updated: "10:09:00"),
            session("failed", .failed, updated: "10:01:00"),
            session("late", .awaitingApproval, updated: "10:08:00"),
            session("running", .running, updated: "10:07:00"),
            session("early", .awaitingApproval, updated: "10:02:00"),
        ])
        #expect(board.queue.map(\.id) == ["early", "late", "failed"])
        #expect(board.ordered.map(\.id) == ["early", "late", "failed", "running", "idle"])
    }

    @Test func eachStateIsInOneLaneMostRecentFirst() {
        let board = OverviewBoard(sessions: [
            session("starting", .starting, updated: "10:00:00"),
            session("running", .running, updated: "10:05:00"),
            session("idle-old", .idle, updated: "10:01:00"),
            session("idle-new", .idle, updated: "10:06:00"),
            session("resumable", .resumable, updated: "10:02:00"),
            session("ended", .ended, updated: "10:03:00"),
        ])
        #expect(board.queue.isEmpty)
        #expect(board.sessions(in: .working).map(\.id) == ["running", "starting"])
        #expect(board.sessions(in: .idle).map(\.id) == ["idle-new", "idle-old"])
        #expect(board.sessions(in: .stopped).map(\.id) == ["ended", "resumable"])
        #expect(board.total == 6)
    }

    @Test func everySessionStateHasAPlaceOnTheBoard() {
        let sessions = SessionState.allCases.enumerated().map { index, state in
            session("s\(index)", state, updated: "10:0\(index):00")
        }
        let board = OverviewBoard(sessions: sessions)
        #expect(Set(board.ordered.map(\.id)) == Set(sessions.map(\.id)))
        #expect(board.ordered.count == sessions.count)
    }

    @Test func aWorkspaceFilterKeepsOnlyItsSessions() {
        let board = OverviewBoard(
            sessions: [
                session("a", .awaitingApproval, updated: "10:00:00", workspace: "w1"),
                session("b", .awaitingApproval, updated: "10:01:00", workspace: "w2"),
                session("c", .idle, updated: "10:02:00", workspace: "w2"),
            ],
            workspaceId: "w2")
        #expect(board.ordered.map(\.id) == ["b", "c"])
        #expect(board.total == 2)
    }

    @Test func timesOfDayAreShownForTodayAndDatesOtherwise() throws {
        let now = try Date.ISO8601FormatStyle().parse("2026-11-21T12:00:00Z")
        let today = try #require(OverviewTime.short("2026-11-21T11:30:00.000Z", now: now))
        let earlier = try #require(OverviewTime.short("2026-11-02T11:30:00Z", now: now))
        #expect(!today.contains("Nov"))
        #expect(earlier.contains("Nov"))
        #expect(OverviewTime.short("not a time") == nil)
    }
}
