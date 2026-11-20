import PicaProtocol

/// What the session chip shows: the session's context use, tokens and credits from its events, and its budget limit
/// from `Session.budgetCredits` (docs/usage.md).
public struct SessionUsageFigures: Equatable, Sendable {
    public var inputTokens: Int
    public var cachedInputTokens: Int
    public var outputTokens: Int
    public var credits: Credits
    public var contextTokens: Count?
    public var contextLimit: Count?
    public var budgetCredits: Credits?

    public init(
        inputTokens: Int = 0, cachedInputTokens: Int = 0, outputTokens: Int = 0, credits: Credits = 0,
        contextTokens: Count? = nil, contextLimit: Count? = nil, budgetCredits: Credits? = nil
    ) {
        self.inputTokens = inputTokens
        self.cachedInputTokens = cachedInputTokens
        self.outputTokens = outputTokens
        self.credits = credits
        self.contextTokens = contextTokens
        self.contextLimit = contextLimit
        self.budgetCredits = budgetCredits
    }

    public var totalTokens: Int { inputTokens + outputTokens }

    /// Context use from 0 to 1, once the runtime has reported it.
    public var contextFraction: Double? {
        guard let contextTokens, let contextLimit, contextLimit > 0 else { return nil }
        return min(Double(contextTokens) / Double(contextLimit), 1)
    }

    /// Credits spent over the limit, when the session has one; not capped, since spend can pass a soft cap.
    public var budgetFraction: Double? {
        guard let budgetCredits else { return nil }
        return budgetCredits > 0 ? credits / budgetCredits : 1
    }

    /// The worse of the context and budget tones.
    public var tone: UsageTone {
        max(UsageTone(fraction: contextFraction), UsageTone(fraction: budgetFraction))
    }

    /// "Context 42% · 18.3K tokens · 1.2 of 300 credits".
    public var text: String {
        let context = contextFraction.map { "Context \(UsageFormat.percent($0))" } ?? "Context –"
        return "\(context) · \(UsageFormat.tokens(totalTokens)) tokens · \(creditsText)"
    }

    /// The chip in a narrow column: context use alone.
    public var compactText: String {
        contextFraction.map { UsageFormat.percent($0) } ?? "–"
    }

    var creditsText: String {
        guard let budgetCredits else { return "\(UsageFormat.credits(credits)) credits" }
        return "\(UsageFormat.credits(credits)) of \(UsageFormat.credits(budgetCredits)) credits"
    }

    var help: String {
        var lines = [
            "Input \(inputTokens.formatted()) tokens (\(cachedInputTokens.formatted()) cached)",
            "Output \(outputTokens.formatted()) tokens",
        ]
        if let contextTokens, let contextLimit {
            lines.append("Context \(contextTokens.formatted()) of \(contextLimit.formatted()) tokens")
        }
        lines.append(budgetCredits == nil ? "No budget limit" : "Budget \(creditsText)")
        return lines.joined(separator: "\n")
    }
}

/// The chip popover's breakdown of one session, from the ledger.
public struct SessionUsageBreakdown: Equatable, Sendable {
    public let byAgent: [UsageBar]
    public let byModel: [UsageBar]
    public let savings: SavingsFigure

    public init(byAgent: UsageRollupResult, byModel: UsageRollupResult) {
        self.byAgent = UsageBar.ranked(byAgent.rows, label: { $0 })
        self.byModel = UsageBar.ranked(byModel.rows, label: { $0 })
        savings = SavingsFigure(byAgent.savings)
    }
}
