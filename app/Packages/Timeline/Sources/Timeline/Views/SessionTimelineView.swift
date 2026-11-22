import DesignSystem
import SwiftUI

/// The selected session's timeline (PLAN.md §7.2): a virtualized list of rows under the usage header.
public struct SessionTimelineView: View {
    private let store: TimelineStore
    private let title: String
    private let usageChip: UsageChipView?
    private let titleActions: TimelineTitleActions?

    public init(
        store: TimelineStore, title: String, usageChip: UsageChipView? = nil, titleActions: TimelineTitleActions? = nil
    ) {
        self.store = store
        self.title = title
        self.usageChip = usageChip
        self.titleActions = titleActions
    }

    public var body: some View {
        VStack(spacing: 0) {
            TimelineHeader(store: store, title: title, usageChip: usageChip, titleActions: titleActions)
            if !store.hasCaughtUp {
                ProgressView("Loading the session…")
                    .controlSize(.small)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.entries.isEmpty {
                // A caption rather than `EmptyState`, whose one-line title would set the column's minimum width.
                Text("No messages yet. Messages, tool calls and agents appear here as the session runs.")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(Spacing.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                TimelineList(store: store)
            }
        }
        .background(Palette.background)
    }
}

/// The rows. Only the visible ones are built; the newest stays in sight while the user is at the bottom.
private struct TimelineList: View {
    let store: TimelineStore
    @State private var follow = ScrollFollow()
    @Environment(TimelineMetrics.self) private var metrics: TimelineMetrics?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Spacing.small) {
                    ForEach(store.entries) { entry in
                        TimelineRow(entry: entry)
                    }
                }
                .padding(.horizontal, Spacing.large)
                .padding(.vertical, Spacing.small)
            }
            .defaultScrollAnchor(.bottom)
            .onScrollGeometryChange(for: ScrollFollow.Geometry.self) { geometry in
                ScrollFollow.Geometry(
                    offset: geometry.contentOffset.y, contentHeight: geometry.contentSize.height,
                    viewportHeight: geometry.containerSize.height)
            } action: { old, new in
                follow.update(from: old, to: new)
                metrics?.scrolled(from: old, to: new)
                // A row can grow after it was scrolled to (a lazily built row is measured late), so keep the newest
                // row in sight while following.
                if follow.isFollowing, new.contentHeight > old.contentHeight, !new.isAtBottom,
                    let last = store.entries.last
                {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
            .onChange(of: store.revision) {
                metrics?.applied(store)
                guard follow.isFollowing, let last = store.entries.last else { return }
                proxy.scrollTo(last.id, anchor: .bottom)
            }
            .onAppear {
                if let last = store.entries.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
                metrics?.timelineAppeared(store)
            }
            .background {
                if let metrics {
                    FrameProbe(metrics: metrics)
                }
            }
        }
        .accessibilityIdentifier("pica.timeline.list")
    }
}
