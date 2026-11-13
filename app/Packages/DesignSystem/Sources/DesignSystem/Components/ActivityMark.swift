import SwiftUI

/// The brand's ring and sparks (PLAN.md §7.3). The sparks animate while an agent is working;
/// the ring doubles as a progress shape when `progress` is set.
public struct ActivityMark: View {
    private let isWorking: Bool
    private let progress: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(isWorking: Bool, progress: Double? = nil) {
        self.isWorking = isWorking
        self.progress = progress.map { min(max($0, 0), 1) }
    }

    public var body: some View {
        let motion = SparkMotion(isWorking: isWorking, reduceMotion: reduceMotion)
        TimelineView(.animation(paused: !motion.isAnimating)) { context in
            ActivityMarkCanvas(pose: motion.pose(at: context.date), progress: progress)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityElement()
        .accessibilityAddTraits([.isImage, .updatesFrequently])
        .accessibilityLabel(isWorking ? "Working" : "Idle")
        .accessibilityValue(progress.map { "\(Int(($0 * 100).rounded())) percent" } ?? "")
    }
}

/// Draws one frame of the mark. Geometry follows the logo: the ring opens at the lower left,
/// and the sparks sit inside it at the upper left.
struct ActivityMarkCanvas: View {
    let pose: SparkPose
    let progress: Double?

    private static let ringStart = Angle.degrees(151)
    private static let ringSweep = 252.0
    private static let sparkAngles = [Angle.degrees(218), Angle.degrees(249)]

    var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = side * 0.4
            let lineWidth = max(side * 0.08, 1.5)
            let stroke = StrokeStyle(lineWidth: lineWidth, lineCap: .round)

            if let progress {
                context.stroke(Self.arc(center, radius, fraction: 1), with: .style(Palette.ring.opacity(0.35)), style: stroke)
                if progress > 0 {
                    context.stroke(Self.arc(center, radius, fraction: progress), with: .style(Palette.accent), style: stroke)
                }
            } else {
                context.stroke(Self.arc(center, radius, fraction: 1), with: .style(Palette.ring), style: stroke)
            }

            for (angle, emphasis) in zip(Self.sparkAngles, [pose.first, pose.second]) {
                context.stroke(
                    Self.spark(center, radius, angle: angle, emphasis: emphasis),
                    with: .style(Palette.spark.opacity(emphasis)),
                    style: stroke)
            }
        }
    }

    private static func arc(_ center: CGPoint, _ radius: CGFloat, fraction: Double) -> Path {
        Path { path in
            path.addArc(
                center: center, radius: radius, startAngle: ringStart,
                endAngle: ringStart + .degrees(ringSweep * fraction), clockwise: false)
        }
    }

    private static func spark(_ center: CGPoint, _ radius: CGFloat, angle: Angle, emphasis: Double) -> Path {
        let middle = radius * 0.6
        let halfLength = radius * (0.06 + 0.08 * emphasis)
        let direction = CGPoint(x: cos(angle.radians), y: sin(angle.radians))
        return Path { path in
            path.move(to: CGPoint(x: center.x + direction.x * (middle - halfLength), y: center.y + direction.y * (middle - halfLength)))
            path.addLine(to: CGPoint(x: center.x + direction.x * (middle + halfLength), y: center.y + direction.y * (middle + halfLength)))
        }
    }
}
