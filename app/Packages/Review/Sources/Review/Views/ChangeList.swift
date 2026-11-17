import DesignSystem
import PicaProtocol
import SwiftUI

/// The changed files: staged first, then unstaged and untracked, each with its change letter. Selecting one shows
/// its diff.
struct ChangeList: View {
    let store: ReviewStore
    let actions: ReviewActions

    var body: some View {
        List(selection: Binding(get: { store.selection }, set: { store.select($0) })) {
            if store.repos.count > 1 {
                Picker("Repo", selection: Binding(get: { store.repoId ?? "" }, set: { id in Task { await store.selectRepo(id) } })) {
                    ForEach(store.repos) { repo in
                        Text(repo.name).tag(repo.id)
                    }
                }
                .accessibilityIdentifier("pica.review.repo")
            }
            section("Staged", files: store.staged, id: "staged")
            section("Changes", files: store.unstaged, id: "unstaged")
        }
        .listStyle(.sidebar)
        .accessibilityIdentifier("pica.review.files")
    }

    @ViewBuilder
    private func section(_ title: String, files: [ReviewFile], id: String) -> some View {
        Section {
            ForEach(files) { file in
                ChangeListRow(file: file)
                    .tag(file.id)
                    .contextMenu { FileActionButtons(file: file, actions: actions) }
            }
        } header: {
            HStack {
                Text("\(title) (\(files.count))")
                Spacer()
                if id == "unstaged", !files.isEmpty {
                    Button("Stage All") { Task { await store.stageAll() } }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("pica.review.stageAll")
                }
            }
            .accessibilityIdentifier("pica.review.section.\(id)")
        }
    }
}

struct ChangeListRow: View {
    let file: ReviewFile

    var body: some View {
        HStack(spacing: Spacing.small) {
            Text(ChangePresentation.letter(file.diff.change))
                .font(Typography.code)
                .foregroundStyle(ChangePresentation.color(file.diff.change))
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 0) {
                Text((file.path as NSString).lastPathComponent)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                let directory = (file.path as NSString).deletingLastPathComponent
                if !directory.isEmpty {
                    Text(directory)
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("pica.review.file.\(file.side.rawValue).\(file.path)")
    }
}
