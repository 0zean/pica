import PicaProtocol

extension SessionEvent {
    /// The event's position in its session's log.
    var seq: Seq {
        switch self {
        case .sessionStateChanged(let event): event.seq
        case .userMessage(let event): event.seq
        case .assistantDelta(let event): event.seq
        case .assistantMessage(let event): event.seq
        case .toolStarted(let event): event.seq
        case .toolCompleted(let event): event.seq
        case .toolFailed(let event): event.seq
        case .subagentStarted(let event): event.seq
        case .subagentCompleted(let event): event.seq
        case .subagentFailed(let event): event.seq
        case .policyDecision(let event): event.seq
        case .approvalRequested(let event): event.seq
        case .approvalResolved(let event): event.seq
        case .usageRecorded(let event): event.seq
        case .contextUsage(let event): event.seq
        case .budgetWarning(let event): event.seq
        case .budgetExhausted(let event): event.seq
        case .sessionAborted(let event): event.seq
        case .sessionError(let event): event.seq
        case .runtimeUnknown(let event): event.seq
        case .unknown(let event): event.seq
        }
    }
}
