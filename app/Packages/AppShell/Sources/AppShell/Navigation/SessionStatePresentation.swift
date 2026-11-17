import DesignSystem
import PicaProtocol

/// How a session's state reads in the sidebar.
public struct SessionStatePresentation: Equatable, Sendable {
    public var label: String
    public var tone: Chip.Tone
    public var isWorking: Bool

    public init(_ state: SessionState) {
        switch state {
        case .starting: self.init(label: "Starting", tone: .neutral, isWorking: true)
        case .idle: self.init(label: "Idle", tone: .neutral, isWorking: false)
        case .running: self.init(label: "Running", tone: .accent, isWorking: true)
        case .awaitingApproval: self.init(label: "Needs approval", tone: .warning, isWorking: false)
        case .failed: self.init(label: "Failed", tone: .danger, isWorking: false)
        case .resumable: self.init(label: "Interrupted", tone: .neutral, isWorking: false)
        case .ended: self.init(label: "Ended", tone: .neutral, isWorking: false)
        }
    }

    private init(label: String, tone: Chip.Tone, isWorking: Bool) {
        self.label = label
        self.tone = tone
        self.isWorking = isWorking
    }
}
