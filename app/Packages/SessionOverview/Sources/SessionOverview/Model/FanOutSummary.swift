import PicaProtocol

/// One fan-out run as its aggregate view shows it (R-11): how far it has got, and each repo's result.
public struct FanOutSummary: Equatable, Sendable, Identifiable {
    public struct Run: Equatable, Sendable, Identifiable {
        public let repoId: Id
        public let repoName: String
        public let sessionId: Id?
        public let status: FanOutRunStatus
        public let errorMessage: String?

        public var id: Id { repoId }
    }

    public let id: Id
    public let prompt: String
    public let workspaceName: String
    public let state: FanOutState
    public let runs: [Run]
    public let counts: FanOut.Counts
    public let concurrency: Int

    public init(_ fanOut: FanOut, workspaceName: String, repoName: (Id) -> String) {
        id = fanOut.id
        prompt = fanOut.prompt
        self.workspaceName = workspaceName
        state = fanOut.state
        counts = fanOut.counts
        concurrency = fanOut.concurrency
        runs = fanOut.runs.map { run in
            Run(
                repoId: run.repoId, repoName: repoName(run.repoId), sessionId: run.sessionId, status: run.status,
                errorMessage: run.error?.message)
        }
    }

    public var settled: Int { counts.succeeded + counts.failed + counts.cancelled }

    /// The share of runs that have finished, for the ring.
    public var progress: Double {
        runs.isEmpty ? 1 : Double(settled) / Double(runs.count)
    }

    public var isActive: Bool { state == .running || state == .cancelling }

    /// "2 of 6 done · 1 failed · 3 running", leaving out what is zero.
    public var countsLine: String {
        var parts = ["\(settled) of \(runs.count) done"]
        if counts.succeeded > 0 { parts.append("\(counts.succeeded) succeeded") }
        if counts.failed > 0 { parts.append("\(counts.failed) failed") }
        if counts.cancelled > 0 { parts.append("\(counts.cancelled) cancelled") }
        if counts.active > 0 { parts.append("\(counts.active) running") }
        if counts.queued > 0 { parts.append("\(counts.queued) queued") }
        return parts.joined(separator: " · ")
    }
}

extension FanOutState {
    var label: String {
        switch self {
        case .running: "Running"
        case .cancelling: "Cancelling"
        case .completed: "Completed"
        case .cancelled: "Cancelled"
        }
    }
}

extension FanOutRunStatus {
    var label: String {
        switch self {
        case .queued: "Queued"
        case .starting: "Starting"
        case .running: "Running"
        case .awaitingApproval: "Needs approval"
        case .succeeded: "Succeeded"
        case .failed: "Failed"
        case .cancelled: "Cancelled"
        }
    }
}
