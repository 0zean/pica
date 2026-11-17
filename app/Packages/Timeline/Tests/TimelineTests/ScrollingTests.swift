import QuartzCore
import Testing
@testable import Timeline

@Suite struct ScrollFollowTests {
    private func geometry(_ offset: CGFloat, content: CGFloat = 1000) -> ScrollFollow.Geometry {
        ScrollFollow.Geometry(offset: offset, contentHeight: content, viewportHeight: 400)
    }

    @Test func scrollingUpStopsFollowingAndScrollingBackToTheBottomResumesIt() {
        var follow = ScrollFollow()
        follow.update(from: geometry(600), to: geometry(300))
        #expect(!follow.isFollowing)
        follow.update(from: geometry(300), to: geometry(596))
        #expect(follow.isFollowing)
    }

    @Test func contentGrowingDoesNotChangeWhetherItFollows() {
        var follow = ScrollFollow()
        // Rows arrive below while at the bottom: the offset is unchanged, the content taller.
        follow.update(from: geometry(600), to: geometry(600, content: 1200))
        #expect(follow.isFollowing)
        follow.update(from: geometry(600, content: 1200), to: geometry(300, content: 1200))
        follow.update(from: geometry(300, content: 1200), to: geometry(300, content: 1500))
        #expect(!follow.isFollowing)
    }
}

@Suite struct FrameClockTests {
    private let frame = 1.0 / 120

    @Test func onlyFramesWhileScrollingCountAndALateOneIsAHitch() {
        var clock = FrameClock()
        #expect(clock.record(timestamp: 0, targetTimestamp: frame) == .idle)
        clock.lastScroll = frame
        #expect(clock.record(timestamp: frame, targetTimestamp: 2 * frame) == .scrolled(duration: frame, late: nil))
        // The main thread was busy over two refreshes: the frame came two frames late.
        let late = clock.record(timestamp: 4 * frame, targetTimestamp: 5 * frame)
        #expect(late == .scrolled(duration: 3 * frame, late: 2 * frame))
        #expect(clock.record(timestamp: 4 * frame + 0.2, targetTimestamp: 5 * frame + 0.2) == .stoppedScrolling)
    }
}

@Suite struct ScrollScriptTests {
    @Test func itGoesUpThenBackDownThenEnds() {
        var script = ScrollScript()
        let leg = ScrollScript.distance / ScrollScript.speed
        #expect(script.offsetAbove(at: 10) == 0)
        #expect(script.offsetAbove(at: 10 + leg / 2) == ScrollScript.distance / 2)
        #expect(script.offsetAbove(at: 10 + leg * 1.5) == ScrollScript.distance / 2)
        #expect(script.offsetAbove(at: 10 + leg * 2.1) == nil)
    }
}
