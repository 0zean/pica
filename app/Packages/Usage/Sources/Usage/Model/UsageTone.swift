import DesignSystem
import PicaProtocol

/// How alarming a share of a limit is, at C-09's default warning thresholds (docs/usage.md).
public enum UsageTone: Int, Comparable, Sendable {
    case neutral
    case warning
    case danger

    public static let warningThreshold = 0.75
    public static let dangerThreshold = 0.9

    public init(fraction: Double?) {
        guard let fraction else {
            self = .neutral
            return
        }
        self = fraction >= Self.dangerThreshold ? .danger : fraction >= Self.warningThreshold ? .warning : .neutral
    }

    public static func < (lhs: UsageTone, rhs: UsageTone) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    var chipTone: Chip.Tone {
        switch self {
        case .neutral: .neutral
        case .warning: .warning
        case .danger: .danger
        }
    }

    var color: PicaColor {
        switch self {
        case .neutral: Palette.accent
        case .warning: Palette.warning
        case .danger: Palette.danger
        }
    }
}

/// How usage figures are written.
enum UsageFormat {
    static func credits(_ credits: Credits) -> String {
        credits.formatted(.number.precision(.fractionLength(0...2)))
    }

    /// 950, 12.3K, 1.2M.
    static func tokens(_ count: Int) -> String {
        count.formatted(.number.notation(.compactName).precision(.significantDigits(1...3)))
    }

    static func percent(_ fraction: Double) -> String {
        fraction.formatted(.percent.precision(.fractionLength(0)))
    }

    static func calls(_ count: Int) -> String {
        count == 1 ? "1 call" : "\(count.formatted()) calls"
    }
}
