import DesignSystem
import PicaProtocol
import SwiftUI

/// A server's health (M-06) as a chip; the last error is its help text.
struct HealthChip: View {
    let status: McpServerStatus?

    var body: some View {
        Chip(title, systemImage: symbol, tone: tone)
            .help(status?.lastError ?? title)
            .accessibilityLabel(title)
            .accessibilityValue(status?.lastError ?? "")
    }

    var title: String {
        guard let status else { return "Not checked" }
        return switch status.state {
        case .connecting: status.restarts > 0 ? "Restarting" : "Connecting"
        case .healthy: "Healthy"
        case .degraded: "Slow"
        case .needsAuth: "Needs sign-in"
        case .failed: "Failed"
        case .stopped: "Stopped"
        }
    }

    private var symbol: String {
        switch status?.state {
        case .healthy: "checkmark.circle"
        case .degraded: "tortoise"
        case .needsAuth: "key"
        case .failed: "exclamationmark.triangle"
        case .connecting, .stopped, nil: "circle.dotted"
        }
    }

    private var tone: Chip.Tone {
        switch status?.state {
        case .healthy: .success
        case .degraded, .needsAuth: .warning
        case .failed: .danger
        case .connecting, .stopped, nil: .neutral
        }
    }
}

/// Tool-definition tokens as the token-cost column shows them: what the server adds to every prompt it is attached to.
enum TokenText {
    static func format(_ tokens: Count?) -> String {
        guard let tokens else { return "—" }
        return "\(tokens.formatted()) tokens"
    }
}

extension McpServerDef {
    /// Where the server runs: its URL's host, or its command.
    var location: String {
        switch transport {
        case .stdio(let stdio): ([stdio.command] + stdio.args).joined(separator: " ")
        case .http(let http): URL(string: http.url)?.host() ?? http.url
        }
    }

    var scopeTitle: String {
        switch scope {
        case .global: "Global"
        case .workspace: "Workspace"
        case .repo: "Repo"
        }
    }
}
