import QuartzCore

/// The scroll `TimelineMetrics` performs when `PICA_TIMELINE_SCROLL_SCRIPT` is set: up from the bottom at a steady
/// speed, then back down, moving by however much time passed since the last frame, as momentum scrolling does.
/// It runs inside the app so that nothing else, such as a UI test querying the window, uses the main thread meanwhile.
struct ScrollScript {
    /// Points per second, a brisk scroll.
    static let speed: Double = 2_400
    static let distance: Double = 9_600
    /// How long after the session opened the script starts. The UI test's last keystroke is followed by its
    /// accessibility queries of the app, which hold the main thread; they are over by then.
    static let settle: CFTimeInterval = 2

    private var start: CFTimeInterval?

    /// How far above its starting point the timeline should be at `timestamp`, or nil when the script has finished.
    mutating func offsetAbove(at timestamp: CFTimeInterval) -> Double? {
        let start = self.start ?? timestamp
        self.start = start
        let travelled = (timestamp - start) * Self.speed
        if travelled <= Self.distance { return travelled }
        if travelled <= 2 * Self.distance { return 2 * Self.distance - travelled }
        return nil
    }
}
