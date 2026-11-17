import AppKit
import EngineClient
import Foundation
import PicaProtocol

/// A system notification for a session that starts waiting for approval (A-07, docs/approvals.md).
public struct ApprovalNotification: Equatable, Sendable {
    public var sessionId: Id
    public var title: String
    public var subtitle: String
    public var body: String

    public init(sessionId: Id, title: String, subtitle: String, body: String) {
        self.sessionId = sessionId
        self.title = title
        self.subtitle = subtitle
        self.body = body
    }
}

/// Where approval notifications go: Notification Center in the app, a recorder in tests.
@MainActor
public protocol ApprovalNotificationPosting: AnyObject {
    func post(_ notification: ApprovalNotification)
    /// Withdraws the session's notification once nothing in it waits for approval.
    func remove(sessionId: Id)
}

/// Posts a notification when a session enters `awaiting_approval`, and withdraws it when the session leaves that
/// state. While Pica is the active app it posts nothing: the session sorts to the top of the sidebar and its card is
/// in the timeline, so a banner would only cover the window.
@MainActor
public final class ApprovalNotifier {
    private let poster: any ApprovalNotificationPosting
    private let isFrontmost: @MainActor () -> Bool
    private let pendingSummary: @Sendable (Id) async -> String?
    private var states: [Id: SessionState] = [:]
    private var following: Task<Void, Never>?

    public init(
        poster: any ApprovalNotificationPosting,
        isFrontmost: @escaping @MainActor () -> Bool,
        pendingSummary: @escaping @Sendable (Id) async -> String?
    ) {
        self.poster = poster
        self.isFrontmost = isFrontmost
        self.pendingSummary = pendingSummary
    }

    /// Notifications for `client`'s sessions through Notification Center; a click selects the session in `navigation`.
    /// `PICA_NOTIFICATIONS=off` (as the UI tests set) posts nothing, so no test meets the permission prompt.
    public static func live(
        client: EngineClient, navigation: NavigationStore,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> ApprovalNotifier? {
        guard environment["PICA_NOTIFICATIONS"] != "off" else { return nil }
        let poster = UserNotificationPoster { sessionId in
            navigation.select(.session(sessionId))
            NSApplication.shared.activate()
        }
        let notifier = ApprovalNotifier(
            poster: poster, isFrontmost: { NSApplication.shared.isActive },
            pendingSummary: { sessionId in
                let approvals = try? await client.request(Methods.ApprovalList.self, BySession(sessionId: sessionId)).approvals
                return approvals?.first?.summary
            })
        notifier.follow(client)
        return notifier
    }

    private func follow(_ client: EngineClient) {
        guard following == nil else { return }
        following = Task {
            let changes = await client.notifications(Notifications.SessionChanged.self)
            for await change in changes {
                await self.sessionChanged(change.session)
            }
        }
    }

    public func sessionChanged(_ session: Session) async {
        let previous = states[session.id]
        states[session.id] = session.state
        if session.state == .awaitingApproval, previous != .awaitingApproval {
            guard !isFrontmost() else { return }
            let summary = await pendingSummary(session.id)
            // The session may have moved on while the summary was read.
            guard states[session.id] == .awaitingApproval else { return }
            poster.post(ApprovalNotification(
                sessionId: session.id, title: "Approval needed", subtitle: session.displayTitle,
                body: summary ?? "A tool call is waiting for your approval."))
        } else if previous == .awaitingApproval, session.state != .awaitingApproval {
            poster.remove(sessionId: session.id)
        }
    }
}
