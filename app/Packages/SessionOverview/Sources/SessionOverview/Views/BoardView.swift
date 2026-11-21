import DesignSystem
import PicaProtocol
import SwiftUI

/// The attention queue across the top, then a lane per kind of state. Nothing on it moves or ticks while no session
/// changes, so an open board costs no CPU (PLAN.md §9).
struct BoardView: View {
    let board: OverviewBoard
    let workspaceNames: [Id: String]
    let open: (Id) -> Void

    var body: some View {
        if board.total == 0 {
            EmptyState("No sessions", message: "Sessions you start in any workspace appear here.")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xLarge) {
                    queue
                    HStack(alignment: .top, spacing: Spacing.large) {
                        ForEach(OverviewBoard.Lane.allCases) { lane in
                            laneColumn(lane)
                        }
                    }
                }
                .padding(Spacing.large)
            }
            .accessibilityIdentifier("pica.overview.board")
        }
    }

    @ViewBuilder private var queue: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            sectionTitle("Needs You", count: board.queue.count)
            if board.queue.isEmpty {
                Text("Nothing is waiting for you.")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: Spacing.small)], spacing: Spacing.small) {
                    ForEach(board.queue, id: \.id) { session in
                        card(session)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.overview.queue")
    }

    private func laneColumn(_ lane: OverviewBoard.Lane) -> some View {
        let sessions = board.sessions(in: lane)
        return VStack(alignment: .leading, spacing: Spacing.small) {
            sectionTitle(lane.title, count: sessions.count)
            ForEach(sessions, id: \.id) { session in
                card(session)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.overview.lane.\(lane.rawValue)")
    }

    private func sectionTitle(_ title: String, count: Int) -> some View {
        HStack(spacing: Spacing.xSmall) {
            Text(title).font(Typography.headline)
            Text(String(count)).font(Typography.caption).foregroundStyle(Palette.textSecondary)
        }
        .foregroundStyle(Palette.textPrimary)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func card(_ session: Session) -> some View {
        SessionCard(session: session, workspaceName: workspaceNames[session.workspaceId] ?? "") {
            open(session.id)
        }
    }
}

/// One session on the board. Clicking it opens the session in the main window.
struct SessionCard: View {
    let session: Session
    let workspaceName: String
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: Spacing.xSmall) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.small) {
                    Text(session.overviewTitle)
                        .font(Typography.headline)
                        .lineLimit(1)
                        .foregroundStyle(Palette.textPrimary)
                    Spacer(minLength: Spacing.xSmall)
                    StateChip(state: session.state)
                }
                HStack(spacing: Spacing.xSmall) {
                    Text(workspaceName)
                    if let updated = OverviewTime.short(session.updatedAt) {
                        Text("·")
                        Text(updated)
                    }
                }
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecondary)
                .lineLimit(1)
            }
            .padding(Spacing.medium)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Radius.large, style: .continuous).fill(Palette.surface))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                    .strokeBorder(session.state == .awaitingApproval ? Palette.warning : Palette.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(session.overviewTitle), \(session.state.overviewLabel), \(workspaceName)")
        .accessibilityHint("Opens the session")
        .accessibilityIdentifier("pica.overview.session.\(session.id)")
    }
}

struct StateChip: View {
    let state: SessionState

    var body: some View {
        switch state {
        case .awaitingApproval: Chip(state.overviewLabel, systemImage: "hand.raised", tone: .warning)
        case .failed: Chip(state.overviewLabel, systemImage: "xmark", tone: .danger)
        case .running, .starting: Chip(state.overviewLabel, systemImage: "sparkles", tone: .accent)
        case .idle, .resumable, .ended: Chip(state.overviewLabel)
        }
    }
}

/// Timestamps as the engine writes them (ISO 8601, UTC), shown as a time of day, or a date when not today.
enum OverviewTime {
    static func short(_ timestamp: Timestamp, now: Date = Date()) -> String? {
        let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        guard let date = (try? fractional.parse(timestamp)) ?? (try? Date.ISO8601FormatStyle().parse(timestamp)) else {
            return nil
        }
        return Calendar.current.isDate(date, inSameDayAs: now)
            ? date.formatted(date: .omitted, time: .shortened)
            : date.formatted(date: .abbreviated, time: .shortened)
    }
}
