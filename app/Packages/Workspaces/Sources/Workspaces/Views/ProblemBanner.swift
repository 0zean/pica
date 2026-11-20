import DesignSystem
import PicaProtocol
import SwiftUI

/// A failed request with its fix action as a button (PLAN.md §4.5). `retry` runs when the fix is to try again.
struct ProblemBanner: View {
    let problem: WorkspaceProblem
    let fixes: FixPerformer
    /// Prefixes the banner's accessibility identifiers, e.g. `pica.teams.problem`.
    let identifier: String
    var retry: (() -> Void)?
    var openSettings: (() -> Void)?
    @State private var note: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.small) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Palette.danger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xSmall) {
                Text(problem.message)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("\(identifier).message")
                if let code = problem.code {
                    Text(code.rawValue)
                        .font(Typography.code)
                        .foregroundStyle(Palette.textSecondary)
                }
                if let note {
                    Text(note)
                        .font(Typography.callout)
                        .foregroundStyle(Palette.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("\(identifier).note")
                }
            }
            Spacer(minLength: Spacing.small)
            if let fix = problem.fix, isOffered(fix) {
                Button(fix.label) { perform(fix) }
                    .buttonStyle(.pica(.secondary))
                    .help(fix.target ?? fix.label)
                    .accessibilityIdentifier("\(identifier).fix")
            }
        }
        .padding(Spacing.medium)
        .background(RoundedRectangle(cornerRadius: Radius.medium, style: .continuous).fill(Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: Radius.medium, style: .continuous).strokeBorder(Palette.danger.opacity(0.5)))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
        .onChange(of: problem) { note = nil }
    }

    /// A retry or Settings fix needs a caller that can do it.
    private func isOffered(_ fix: FixAction) -> Bool {
        switch fix.kind {
        case .retry: retry != nil
        case .openSettings: openSettings != nil
        case .openUrl, .runCommand, .signIn: true
        }
    }

    private func perform(_ fix: FixAction) {
        switch fixes.perform(fix) {
        case .done: note = nil
        case .note(let text): note = text
        case .retry: retry?()
        case .openSettings: openSettings?()
        }
    }
}
