import DesignSystem
import PicaProtocol
import SwiftUI

/// Each fan-out run's aggregate (R-11): progress, counts, and every repo's result, newest run first.
struct FanOutListView: View {
    let summaries: [FanOutSummary]
    let store: FanOutStore
    let open: (Id) -> Void

    var body: some View {
        if summaries.isEmpty {
            EmptyState(
                store.failure == nil ? "No fan-outs" : "Fan-outs could not be loaded",
                message: store.failure ?? "A task run over several repos at once appears here.")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.medium) {
                    ForEach(summaries) { summary in
                        FanOutCard(summary: summary, open: open) {
                            Task { await store.cancel(summary.id) }
                        }
                    }
                }
                .padding(Spacing.large)
            }
            .accessibilityIdentifier("pica.overview.fanouts")
        }
    }
}

struct FanOutCard: View {
    let summary: FanOutSummary
    let open: (Id) -> Void
    let cancel: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.medium) {
                header
                VStack(spacing: 0) {
                    ForEach(summary.runs) { run in
                        runRow(run)
                        if run.id != summary.runs.last?.id { Divider() }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.overview.fanout.\(summary.id)")
    }

    private var header: some View {
        HStack(alignment: .top, spacing: Spacing.medium) {
            // Not animated: the ring is the progress, and a still board costs no CPU.
            ActivityMark(isWorking: false, progress: summary.progress)
                .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                Text(summary.prompt)
                    .font(Typography.headline)
                    .lineLimit(2)
                    .foregroundStyle(Palette.textPrimary)
                Text("\(summary.workspaceName) · up to \(summary.concurrency) at once")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
                Text(summary.countsLine)
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textPrimary)
                    .accessibilityIdentifier("pica.overview.fanout.counts")
            }
            Spacer()
            Chip(summary.state.label, tone: summary.state == .completed ? .success : .neutral)
            if summary.isActive {
                Button("Cancel", role: .destructive, action: cancel)
                    .disabled(summary.state == .cancelling)
                    .accessibilityIdentifier("pica.overview.fanout.cancel")
            }
        }
    }

    private func runRow(_ run: FanOutSummary.Run) -> some View {
        HStack(spacing: Spacing.small) {
            VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                Text(run.repoName).font(Typography.body).foregroundStyle(Palette.textPrimary)
                if let message = run.errorMessage {
                    Text(message).font(Typography.caption).foregroundStyle(Palette.danger).lineLimit(2)
                }
            }
            Spacer()
            RunStatusChip(status: run.status)
            if let sessionId = run.sessionId {
                Button("Open") { open(sessionId) }
                    .accessibilityIdentifier("pica.overview.fanout.open.\(run.repoId)")
            }
        }
        .padding(.vertical, Spacing.small)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.overview.fanout.run.\(run.repoId)")
    }
}

struct RunStatusChip: View {
    let status: FanOutRunStatus

    var body: some View {
        switch status {
        case .succeeded: Chip(status.label, systemImage: "checkmark", tone: .success)
        case .failed: Chip(status.label, systemImage: "xmark", tone: .danger)
        case .awaitingApproval: Chip(status.label, systemImage: "hand.raised", tone: .warning)
        case .running, .starting: Chip(status.label, systemImage: "sparkles", tone: .accent)
        case .queued, .cancelled: Chip(status.label)
        }
    }
}
