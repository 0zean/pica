import DesignSystem
import PicaProtocol
import SwiftUI

/// The onboarding window content: the steps with their state, and the current step's details (docs/onboarding.md).
struct OnboardingScreen: View {
    let store: OnboardingStore
    let setUpLater: () -> Void

    var body: some View {
        ZStack {
            BrandBackdrop().ignoresSafeArea()
            ScrollView {
                VStack(spacing: Spacing.xLarge) {
                    header
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.large) {
                            StepList(store: store)
                            Divider()
                            currentStep
                        }
                    }
                    .frame(maxWidth: 560)
                    Button("Set Up Later", action: setUpLater)
                        .buttonStyle(.link)
                        .accessibilityIdentifier("pica.onboarding.later")
                }
                .padding(Spacing.xxLarge)
                .frame(maxWidth: .infinity)
            }
        }
        // Tall enough for the steps and the longest card without scrolling.
        .frame(minWidth: 640, minHeight: 760)
        .task { await store.start() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.onboarding")
    }

    private var header: some View {
        VStack(spacing: Spacing.small) {
            BrandMark().frame(width: 72, height: 72)
            Text("Welcome to Pica")
                .font(Typography.largeTitle)
                .foregroundStyle(Palette.textPrimary)
            Text("A few things to check before your first session.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecondary)
        }
    }

    @ViewBuilder private var currentStep: some View {
        switch store.step {
        case .check(let precondition):
            CheckDetail(store: store, precondition: precondition)
        case .workspace:
            FirstWorkspaceForm(store: store)
        }
    }
}

/// Every step and how it stands. The accessibility value is the state, for the UI tests.
private struct StepList: View {
    let store: OnboardingStore

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            ForEach(Precondition.allCases, id: \.self) { precondition in
                row(precondition.title, state: state(of: precondition), id: precondition.rawValue)
            }
            row("First workspace", state: store.step == .workspace ? .current : .pending, id: "workspace")
        }
    }

    private func state(of precondition: Precondition) -> StepState {
        if precondition == .github && store.skippedGitHub { return .skipped }
        switch store.state(of: precondition) {
        case nil, .checking: return .checking
        case .done(.passed): return .passed
        case .done(.failed): return .failed
        }
    }

    private func row(_ title: String, state: StepState, id: String) -> some View {
        HStack(spacing: Spacing.small) {
            state.icon.frame(width: 18, height: 18)
            Text(title)
                .font(state == .current || state == .failed ? Typography.headline : Typography.body)
                .foregroundStyle(state == .pending ? Palette.textSecondary : Palette.textPrimary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("pica.onboarding.step.\(id)")
        .accessibilityValue(state.rawValue)
    }
}

private enum StepState: String {
    case pending, checking, passed, failed, skipped, current

    @ViewBuilder var icon: some View {
        switch self {
        case .checking: ProgressView().controlSize(.small)
        case .passed: Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.success)
        case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Palette.danger)
        case .skipped: Image(systemName: "minus.circle").foregroundStyle(Palette.textSecondary)
        case .current: Image(systemName: "circle.circle").foregroundStyle(Palette.accent)
        case .pending: Image(systemName: "circle").foregroundStyle(Palette.textSecondary)
        }
    }
}

/// The current check: what failed and its fix, and Check Again, which advances once the check passes.
private struct CheckDetail: View {
    let store: OnboardingStore
    let precondition: Precondition

    private var identifier: String { "pica.onboarding.\(precondition.rawValue)" }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text(prompt)
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
            switch store.state(of: precondition) {
            case nil, .checking:
                HStack(spacing: Spacing.small) {
                    ProgressView().controlSize(.small)
                    Text("Checking…").font(Typography.body).foregroundStyle(Palette.textSecondary)
                }
            case .done(.passed(let detail)):
                Text(detail).font(Typography.body)
            case .done(.failed(let message, let fix)):
                failure(message: message, fix: fix)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }

    private var prompt: String {
        switch precondition {
        case .copilot: "Sign in to GitHub Copilot"
        case .gitInstall: "Install Git"
        case .github: "Sign in to GitHub"
        }
    }

    @ViewBuilder private func failure(message: String, fix: FixAction?) -> some View {
        Text(message)
            .font(Typography.body)
            .foregroundStyle(Palette.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
            .accessibilityIdentifier("\(identifier).message")
        if let note = store.fixNotes[precondition] {
            Text(note)
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .accessibilityIdentifier("\(identifier).note")
        }
        if precondition.isOptional {
            Text("Without it you can still add repositories by path or URL, but not import your teams.")
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        HStack(spacing: Spacing.small) {
            if let fix, fix.kind != .openSettings {
                Button(fix.label) { store.fix(precondition, with: fix) }
                    .buttonStyle(.pica(.primary))
                    .help(fix.target ?? fix.label)
                    .accessibilityIdentifier("\(identifier).fix")
            }
            Button("Check Again") { Task { await store.check(precondition) } }
                .buttonStyle(.pica(.secondary))
                .accessibilityIdentifier("\(identifier).recheck")
            if precondition.isOptional {
                Spacer()
                Button("Continue Without GitHub") { store.skipGitHub() }
                    .buttonStyle(.link)
                    .accessibilityIdentifier("pica.onboarding.skipGitHub")
            }
        }
    }
}

/// The last step: name and create the first workspace. Once it exists, the app shows it and onboarding is done.
private struct FirstWorkspaceForm: View {
    let store: OnboardingStore
    @State private var name = "My Workspace"

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text("Create your first workspace")
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
            Text("A workspace holds the repositories you work on together. You can add repositories and import teams next.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)
                .onSubmit(create)
                .accessibilityIdentifier("pica.onboarding.workspaceName")
            if let problem = store.workspaceProblem {
                Text(problem)
                    .font(Typography.callout)
                    .foregroundStyle(Palette.danger)
                    .accessibilityIdentifier("pica.onboarding.workspaceProblem")
            }
            HStack {
                Spacer()
                Button("Create Workspace", action: create)
                    .buttonStyle(.pica(.primary))
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || store.isCreatingWorkspace)
                    .accessibilityIdentifier("pica.onboarding.createWorkspace")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.onboarding.workspace")
    }

    private func create() {
        Task { await store.createFirstWorkspace(named: name) }
    }
}
