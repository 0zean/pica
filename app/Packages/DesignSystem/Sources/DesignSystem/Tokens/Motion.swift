import SwiftUI

/// Motion tokens. Every animation goes through `Motion.animation(_:reduceMotion:)` so the
/// system's Reduce Motion setting turns it off in one place.
public enum Motion {
    public enum Curve: Sendable {
        /// Hover and press feedback.
        case quick
        /// Showing, hiding, and moving content.
        case standard
        /// Larger transitions such as a panel opening.
        case emphasized
    }

    public static func duration(_ curve: Curve) -> TimeInterval {
        switch curve {
        case .quick: 0.12
        case .standard: 0.2
        case .emphasized: 0.35
        }
    }

    /// The animation for `curve`, or `nil` when Reduce Motion is on.
    public static func animation(_ curve: Curve, reduceMotion: Bool) -> Animation? {
        guard !reduceMotion else { return nil }
        switch curve {
        case .quick: return .easeOut(duration: duration(.quick))
        case .standard: return .easeInOut(duration: duration(.standard))
        case .emphasized: return .spring(duration: duration(.emphasized), bounce: 0.15)
        }
    }

    /// One full cycle of the activity sparks.
    public static let sparkPeriod: TimeInterval = 1.4
}

/// How visible each spark is, from 0 (hidden) to 1 (full).
public struct SparkPose: Equatable, Sendable {
    public var first: Double
    public var second: Double

    public static let idle = SparkPose(first: 0.35, second: 0.35)
    public static let working = SparkPose(first: 1, second: 1)
}

/// Decides whether the sparks animate and where they are at a given moment.
/// With Reduce Motion on, a working mark holds the still `working` pose instead of animating.
public struct SparkMotion: Equatable, Sendable {
    public let isWorking: Bool
    public let isAnimating: Bool

    public init(isWorking: Bool, reduceMotion: Bool) {
        self.isWorking = isWorking
        isAnimating = isWorking && !reduceMotion
    }

    public func pose(at date: Date) -> SparkPose {
        guard isAnimating else { return isWorking ? .working : .idle }
        let cycle = date.timeIntervalSinceReferenceDate / Motion.sparkPeriod
        return SparkPose(first: Self.pulse(cycle), second: Self.pulse(cycle - 0.25))
    }

    private static func pulse(_ cycle: Double) -> Double {
        let wave = (1 - cos(2 * .pi * cycle)) / 2
        return SparkPose.idle.first + (1 - SparkPose.idle.first) * wave
    }
}
