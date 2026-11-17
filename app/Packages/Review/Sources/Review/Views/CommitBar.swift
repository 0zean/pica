import DesignSystem
import PicaProtocol
import SwiftUI

/// Under the diff: the commit message and Commit, then the branch with Push and Open Pull Request, and what the last
/// action did.
struct CommitBar: View {
    @Bindable var store: ReviewStore
    @State private var composingPullRequest = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            HStack(alignment: .bottom, spacing: Spacing.small) {
                TextField("Commit message", text: $store.commitMessage, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)
                    .accessibilityIdentifier("pica.review.commitMessage")
                Button("Commit") { Task { await store.commit() } }
                    .buttonStyle(.pica(.primary))
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(!store.canCommit)
                    .accessibilityIdentifier("pica.review.commit")
            }
            HStack(spacing: Spacing.small) {
                branch
                Spacer(minLength: Spacing.small)
                Button("Push") { Task { await store.push() } }
                    .buttonStyle(.pica(.secondary))
                    .disabled(!store.canPush)
                    .accessibilityIdentifier("pica.review.push")
                Button("Open Pull Request…") { composingPullRequest = true }
                    .buttonStyle(.pica(.secondary))
                    .disabled(!store.canOpenPullRequest)
                    .accessibilityIdentifier("pica.review.openPullRequest")
            }
            outcome
        }
        .padding(Spacing.medium)
        .background(Palette.surface)
        .sheet(isPresented: $composingPullRequest) {
            PullRequestSheet(store: store, isPresented: $composingPullRequest)
        }
    }

    private var branch: some View {
        let status = store.status
        let name = status?.branch ?? "detached HEAD"
        var detail = status?.upstream.map { "→ \($0)" } ?? "not pushed"
        if let status, status.upstream != nil {
            if status.ahead > 0 { detail += " · \(status.ahead) to push" }
            if status.behind > 0 { detail += " · \(status.behind) behind" }
        }
        return HStack(spacing: Spacing.xSmall) {
            Image(systemName: "arrow.triangle.branch")
            Text(name).font(Typography.code)
            Text(detail)
        }
        .font(Typography.caption)
        .foregroundStyle(Palette.textSecondary)
        .lineLimit(1)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("pica.review.branch")
    }

    @ViewBuilder private var outcome: some View {
        switch store.activity {
        case .working(let label):
            HStack(spacing: Spacing.xSmall) {
                ProgressView().controlSize(.small)
                Text(label)
            }
            .font(Typography.caption)
            .foregroundStyle(Palette.textSecondary)
        case .failed(let message):
            Text(message)
                .font(Typography.caption)
                .foregroundStyle(Palette.danger)
                .textSelection(.enabled)
                .accessibilityIdentifier("pica.review.error")
        case .idle:
            if let pullRequest = store.pullRequest, let url = URL(string: pullRequest.url) {
                Link("Pull request #\(pullRequest.number) is open: \(pullRequest.head) → \(pullRequest.base)", destination: url)
                    .font(Typography.caption)
                    .accessibilityIdentifier("pica.review.pullRequest")
            } else if let commit = store.lastCommit {
                Text("Committed \(commit.sha.prefix(7)) “\(commit.subject)”")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.success)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("pica.review.lastCommit")
            }
        }
    }
}

/// The title, description and base branch of a new pull request from the current branch.
struct PullRequestSheet: View {
    let store: ReviewStore
    @Binding var isPresented: Bool
    @State private var title = ""
    @State private var description = ""
    @State private var base = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text("Open Pull Request")
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
            Text("From \(store.status?.branch ?? "this branch") on GitHub.")
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
            TextField("Title", text: $title)
                .accessibilityIdentifier("pica.review.pr.title")
            TextField("Base branch (the repo's default if empty)", text: $base)
                .accessibilityIdentifier("pica.review.pr.base")
            TextField("Description", text: $description, axis: .vertical)
                .lineLimit(4...10)
                .accessibilityIdentifier("pica.review.pr.body")
            HStack {
                Spacer()
                Button("Cancel") { isPresented = false }
                    .buttonStyle(.pica(.secondary))
                    .keyboardShortcut(.cancelAction)
                Button("Open") {
                    let base = base.trimmingCharacters(in: .whitespaces)
                    isPresented = false
                    Task { await store.openPullRequest(title: title, body: description, base: base.isEmpty ? nil : base) }
                }
                .buttonStyle(.pica(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("pica.review.pr.open")
            }
        }
        .textFieldStyle(.roundedBorder)
        .padding(Spacing.xLarge)
        .frame(width: 460)
        .onAppear { title = store.suggestedPullRequestTitle }
    }
}
