import DesignSystem
import PicaProtocol
import SwiftUI

/// An approval request inline in the timeline, with its choices while it waits (A-07, docs/approvals.md): allow
/// once, always allow (tool calls only; the engine saves a permission rule) and deny. Once resolved it shows the
/// choice.
struct ApprovalRow: View {
    let item: ApprovalItem
    @Environment(\.resolveApproval) private var resolveApproval

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
        let isPending = item.choice == nil
        HStack(alignment: .firstTextBaseline, spacing: Spacing.small) {
            Image(systemName: icon)
                .foregroundStyle(isPending ? Palette.warning : Palette.textSecondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xSmall) {
                VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                    Text(item.summary)
                        .font(Typography.body)
                        .foregroundStyle(Palette.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let call {
                        Text(call)
                            .font(Typography.code)
                            .foregroundStyle(Palette.textSecondary)
                            .lineLimit(3)
                    }
                    Text(status)
                        .font(Typography.caption.weight(.medium))
                        .foregroundStyle(statusColor)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("pica.approval.summary")
                if isPending {
                    choices
                }
                if let failure = item.failure {
                    Text(failure)
                        .font(Typography.caption)
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("pica.approval.failure")
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.medium)
        .background(shape.fill(Palette.surface))
        .overlay(shape.strokeBorder(isPending ? Palette.warning : Palette.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }

    private var choices: some View {
        HStack(spacing: Spacing.small) {
            choice(.allowOnce, isBudget ? "Raise Budget" : "Allow Once", role: .primary)
            if !isBudget {
                choice(.allowAlways, "Always Allow", role: .secondary)
                    .help(alwaysHelp)
            }
            choice(.deny, isBudget ? "Stop" : "Deny", role: .secondary)
            if item.isResolving {
                ProgressView().controlSize(.small)
            }
        }
        .disabled(resolveApproval == nil || item.isResolving)
    }

    private func choice(_ choice: ApprovalChoice, _ title: String, role: PicaButtonStyle.Role) -> some View {
        Button(title) {
            guard let resolveApproval else { return }
            Task { await item.resolve(choice, with: resolveApproval) }
        }
        .buttonStyle(.pica(role))
        .accessibilityIdentifier("pica.approval.\(choice.rawValue)")
    }

    private var isBudget: Bool {
        if case .budget = item.kind { true } else { false }
    }

    /// The call as the engine's permission rule would match it.
    private var call: String? {
        guard let toolName = item.toolName else { return nil }
        return item.subject.map { "\(toolName): \($0)" } ?? toolName
    }

    private var alwaysHelp: String {
        let what = item.subject.map { "“\($0)”" } ?? "every call"
        return "Allow this now and \(what) of \(item.toolName ?? "this tool") from now on, without asking. "
            + "Pica saves the rule in config.jsonc."
    }

    private var icon: String {
        switch item.kind {
        case .toolCall: "hand.raised"
        case .budget: "creditcard"
        }
    }

    private var status: String {
        switch item.choice {
        case nil: item.isResolving ? "Sending your choice…" : "Waiting for your approval"
        case .allowOnce: isBudget ? "Budget raised" : "Allowed once"
        case .allowAlways: "Always allowed"
        case .deny: isBudget ? "Stopped" : "Denied"
        }
    }

    private var statusColor: PicaColor {
        switch item.choice {
        case nil: Palette.warning
        case .allowOnce, .allowAlways: Palette.success
        case .deny: Palette.danger
        }
    }
}
