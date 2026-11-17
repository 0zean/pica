import Foundation
import PicaProtocol
@preconcurrency import UserNotifications

/// Approval notifications through `UNUserNotificationCenter`. Pica asks for permission the first time it has
/// something to post, not at launch. One notification per session, identified by the session, so a later request
/// replaces it.
@MainActor
final class UserNotificationPoster: NSObject, ApprovalNotificationPosting, UNUserNotificationCenterDelegate {
    nonisolated static let sessionIdKey = "sessionId"

    private let center = UNUserNotificationCenter.current()
    private let onOpen: @MainActor (Id) -> Void
    private var authorization: Task<Bool, Never>?

    init(onOpen: @escaping @MainActor (Id) -> Void) {
        self.onOpen = onOpen
        super.init()
        center.delegate = self
    }

    func post(_ notification: ApprovalNotification) {
        let content = UNMutableNotificationContent()
        content.title = notification.title
        content.subtitle = notification.subtitle
        content.body = notification.body
        content.sound = .default
        content.threadIdentifier = "approvals"
        content.userInfo = [Self.sessionIdKey: notification.sessionId]
        let request = UNNotificationRequest(identifier: Self.identifier(notification.sessionId), content: content, trigger: nil)
        let center = center
        let authorized = authorize()
        Task {
            guard await authorized.value else { return }
            try? await center.add(request)
        }
    }

    func remove(sessionId: Id) {
        let identifier = Self.identifier(sessionId)
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
    }

    private func authorize() -> Task<Bool, Never> {
        if let authorization { return authorization }
        let center = center
        let task = Task { (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false }
        authorization = task
        return task
    }

    private static func identifier(_ sessionId: Id) -> String {
        "approval.\(sessionId)"
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        guard let sessionId = response.notification.request.content.userInfo[Self.sessionIdKey] as? String else { return }
        await MainActor.run { onOpen(sessionId) }
    }

    /// Posting is skipped while Pica is active; one that arrives as Pica becomes active is not shown as a banner.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.list]
    }
}
