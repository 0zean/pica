import PicaProtocol

/// What the board shows, worked out from the sessions the app knows: the attention queue, then a lane per kind of
/// state. Specified in docs/session-overview.md.
public struct OverviewBoard: Equatable, Sendable {
    public enum Lane: String, CaseIterable, Identifiable, Sendable {
        case working
        case idle
        case stopped

        public var id: String { rawValue }

        public var title: String {
            switch self {
            case .working: "Working"
            case .idle: "Idle"
            case .stopped: "Stopped"
            }
        }

        /// The lane a session that does not need attention is in.
        static func of(_ state: SessionState) -> Lane? {
            switch state {
            case .starting, .running: .working
            case .idle: .idle
            case .resumable, .ended: .stopped
            case .awaitingApproval, .failed: nil
            }
        }
    }

    /// Sessions that cannot go on until the user acts: those awaiting approval first, then failed ones; the one that
    /// has waited longest first within each.
    public let queue: [Session]
    public let lanes: [Lane: [Session]]
    public let total: Int

    public init(sessions: some Sequence<Session>, workspaceId: Id? = nil) {
        let shown = sessions.filter { workspaceId == nil || $0.workspaceId == workspaceId }
        total = shown.count
        queue = shown.filter { Self.queueRank($0.state) != nil }.sorted(by: Self.queueOrder)
        var lanes: [Lane: [Session]] = [:]
        for session in shown {
            guard let lane = Lane.of(session.state) else { continue }
            lanes[lane, default: []].append(session)
        }
        self.lanes = lanes.mapValues { $0.sorted(by: Self.recentFirst) }
    }

    public func sessions(in lane: Lane) -> [Session] {
        lanes[lane] ?? []
    }

    /// Every session in the order the board shows them: the queue, then each lane.
    public var ordered: [Session] {
        queue + Lane.allCases.flatMap(sessions(in:))
    }

    static func queueRank(_ state: SessionState) -> Int? {
        switch state {
        case .awaitingApproval: 0
        case .failed: 1
        default: nil
        }
    }

    private static func queueOrder(_ left: Session, _ right: Session) -> Bool {
        let leftRank = queueRank(left.state) ?? 2
        let rightRank = queueRank(right.state) ?? 2
        if leftRank != rightRank { return leftRank < rightRank }
        if left.updatedAt != right.updatedAt { return left.updatedAt < right.updatedAt }
        return left.id < right.id
    }

    private static func recentFirst(_ left: Session, _ right: Session) -> Bool {
        if left.updatedAt != right.updatedAt { return left.updatedAt > right.updatedAt }
        return left.id < right.id
    }
}

extension SessionState {
    /// How the state reads on the board, as the sidebar words it.
    var overviewLabel: String {
        switch self {
        case .starting: "Starting"
        case .idle: "Idle"
        case .running: "Running"
        case .awaitingApproval: "Needs approval"
        case .failed: "Failed"
        case .resumable: "Interrupted"
        case .ended: "Ended"
        }
    }
}

extension Session {
    var overviewTitle: String {
        title.isEmpty ? "Untitled session" : title
    }
}
