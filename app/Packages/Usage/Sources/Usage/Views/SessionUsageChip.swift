import DesignSystem
import EngineClient
import PicaProtocol
import SwiftUI

/// The session chip over the timeline: context use, tokens and credits against the budget, toned by the worse of the
/// two limits. Clicking it shows the session's breakdown (docs/usage.md). In a narrow column it shows context use
/// alone, or nothing, so it never sets the column's minimum width.
public struct SessionUsageChip: View {
    let figures: SessionUsageFigures
    let sessionId: Id
    let backend: any UsageBackend
    let openDashboard: () -> Void
    @State private var showsDetail = false

    public init(figures: SessionUsageFigures, sessionId: Id, client: EngineClient, openDashboard: @escaping () -> Void) {
        self.init(figures: figures, sessionId: sessionId, backend: EngineUsageBackend(client: client),
                  openDashboard: openDashboard)
    }

    init(figures: SessionUsageFigures, sessionId: Id, backend: any UsageBackend, openDashboard: @escaping () -> Void) {
        self.figures = figures
        self.sessionId = sessionId
        self.backend = backend
        self.openDashboard = openDashboard
    }

    public var body: some View {
        Button {
            showsDetail.toggle()
        } label: {
            SessionUsageChipLabel(figures: figures)
        }
        .buttonStyle(.plain)
        .help(figures.help)
        .accessibilityLabel(figures.text)
        .accessibilityHint("Shows the session’s usage")
        .accessibilityIdentifier("pica.timeline.usage")
        .popover(isPresented: $showsDetail, arrowEdge: .bottom) {
            SessionUsagePopover(
                figures: figures, store: SessionUsageStore(sessionId: sessionId, backend: backend),
                openDashboard: {
                    showsDetail = false
                    openDashboard()
                })
        }
    }
}

struct SessionUsageChipLabel: View {
    let figures: SessionUsageFigures

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Chip(figures.text, systemImage: symbol, tone: figures.tone.chipTone)
            Chip(figures.compactText, systemImage: symbol, tone: figures.tone.chipTone)
            Color.clear.frame(width: 0, height: 0)
        }
    }

    private var symbol: String {
        switch figures.tone {
        case .neutral: "gauge.with.dots.needle.33percent"
        case .warning: "gauge.with.dots.needle.67percent"
        case .danger: "gauge.with.dots.needle.100percent"
        }
    }
}
