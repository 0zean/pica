import AppKit
import SwiftUI

/// Hands the window's display-link callbacks to `TimelineMetrics`, and runs its scroll script on the timeline.
struct FrameProbe: NSViewRepresentable {
    let metrics: TimelineMetrics

    func makeNSView(context: Context) -> FrameProbeView {
        FrameProbeView(metrics: metrics)
    }

    func updateNSView(_ view: FrameProbeView, context: Context) {}

    static func dismantleNSView(_ view: FrameProbeView, coordinator: ()) {
        view.stop()
    }
}

final class FrameProbeView: NSView {
    private let metrics: TimelineMetrics
    private var link: CADisplayLink?
    private var script: (ScrollScript, scrollView: NSScrollView, bottom: CGFloat)?

    init(metrics: TimelineMetrics) {
        self.metrics = metrics
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used from a nib") }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        stop()
        guard window != nil else { return }
        let link = displayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    @objc private func tick(_ link: CADisplayLink) {
        metrics.frame(timestamp: link.timestamp, targetTimestamp: link.targetTimestamp)
        if script == nil, metrics.takeScrollScript(at: link.timestamp), let scrollView = timelineScrollView() {
            script = (ScrollScript(), scrollView, scrollView.contentView.bounds.origin.y)
        }
        runScript(at: link.timestamp)
    }

    private func runScript(at timestamp: CFTimeInterval) {
        guard var (state, scrollView, bottom) = script else { return }
        guard let above = state.offsetAbove(at: timestamp) else {
            script = nil
            metrics.scrollScriptFinished()
            return
        }
        script = (state, scrollView, bottom)
        let clip = scrollView.contentView
        clip.scroll(to: NSPoint(x: clip.bounds.origin.x, y: max(bottom - above, 0)))
        scrollView.reflectScrolledClipView(clip)
    }

    /// The list's scroll view: the one in this window with the tallest document.
    private func timelineScrollView() -> NSScrollView? {
        var found: [NSScrollView] = []
        var pending = [window?.contentView].compactMap { $0 }
        while let view = pending.popLast() {
            if let scrollView = view as? NSScrollView { found.append(scrollView) }
            pending += view.subviews
        }
        return found.max { ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0) }
    }
}
