import Foundation
import SwiftUI
import Testing
@testable import DesignSystem
import DesignSystemTestSupport

@MainActor
@Suite struct ReducedMotionTests {
    private let moments = (0..<12).map { Date(timeIntervalSinceReferenceDate: 1_000 + Double($0) * 0.1) }

    @Test func sparksAnimateWhileWorking() {
        let motion = SparkMotion(isWorking: true, reduceMotion: false)
        #expect(motion.isAnimating)
        #expect(Set(moments.map { motion.pose(at: $0).first }).count > 1)
    }

    @Test func reduceMotionHoldsTheSparksStill() {
        let motion = SparkMotion(isWorking: true, reduceMotion: true)
        #expect(!motion.isAnimating)
        #expect(moments.allSatisfy { motion.pose(at: $0) == .working })
    }

    @Test func idleSparksNeverAnimate() {
        for reduceMotion in [false, true] {
            let motion = SparkMotion(isWorking: false, reduceMotion: reduceMotion)
            #expect(!motion.isAnimating)
            #expect(moments.allSatisfy { motion.pose(at: $0) == .idle })
        }
    }

    @Test func reduceMotionRemovesTokenAnimations() {
        for curve in [Motion.Curve.quick, .standard, .emphasized] {
            #expect(Motion.animation(curve, reduceMotion: true) == nil)
            #expect(Motion.animation(curve, reduceMotion: false) != nil)
        }
    }

    /// Drives the real view through the environment: with Reduce Motion on, a working mark renders the
    /// still pose whatever the time; with it off, it renders a moving pose, which never equals the still
    /// one because the two sparks pulse a quarter cycle apart.
    @Test(arguments: [Appearance.light, .dark])
    func activityMarkFollowsTheReduceMotionSetting(_ appearance: Appearance) {
        func render(_ view: some View) -> Bitmap {
            Snapshot.render(view.frame(width: 64, height: 64), width: 64, appearance: appearance)
        }
        let still = render(ActivityMarkCanvas(pose: .working, progress: nil))
        let reduced = render(ActivityMark(isWorking: true).environment(\._accessibilityReduceMotion, true))
        let animated = render(ActivityMark(isWorking: true).environment(\._accessibilityReduceMotion, false))

        #expect(still.width == 128 && still.height == 128)
        #expect(reduced == still)
        #expect(animated != still)
    }
}
