import PicaProtocol

/// The savings estimate as Pica shows it (PLAN.md §5.6). It is the only way the figure reaches a view, so it is always
/// labeled as an estimate.
public struct SavingsFigure: Equatable, Sendable {
    public static let title = "Estimated savings"
    public static let footnote =
        "An estimate: worker-tier tokens repriced at the reasoning tier’s rates, minus what they cost."

    public let credits: Credits

    public init(_ estimate: SavingsEstimate) {
        credits = estimate.credits
    }

    public var title: String { Self.title }
    public var footnote: String { Self.footnote }

    /// "≈ 199.55 credits".
    public var value: String {
        "≈ \(UsageFormat.credits(credits)) credits"
    }

    /// What VoiceOver reads, the title included.
    public var accessibilityText: String {
        "\(title): about \(UsageFormat.credits(credits)) credits. \(footnote)"
    }
}
