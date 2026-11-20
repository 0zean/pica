import DesignSystem
import PicaProtocol
import SwiftUI

/// Imports servers from other agent platforms' files, or from a pasted `mcpServers` snippet (M-07). Inline secrets
/// are moved to the Keychain by the import; nothing is attached to a session.
struct ImportSheet: View {
    @State var store: McpImportStore
    let done: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text(store.mode == .paste ? "Paste a Server Snippet" : "Import from Other Apps").font(Typography.title)
            switch store.mode {
            case .paste: paste
            case .platforms: platforms
            }
            Picker("Save to", selection: $store.scope) {
                Text("Global").tag(McpScope.global)
                Text("This workspace").tag(McpScope.workspace)
            }
            .pickerStyle(.segmented)
            .fixedSize()
            if let message = store.message {
                Text(message).font(Typography.callout).foregroundStyle(Palette.danger).textSelection(.enabled)
                    .accessibilityIdentifier("pica.mcp.import.error")
            }
            HStack {
                Spacer()
                Button("Cancel", action: done).keyboardShortcut(.cancelAction)
                Button("Import") {
                    Task { if await store.importChosen() { done() } }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!store.canImport || store.isWorking)
                .accessibilityIdentifier("pica.mcp.import.confirm")
            }
        }
        .padding(Spacing.large)
        .frame(width: 600, height: 520)
        .task { if store.mode == .platforms { await store.loadPlatforms() } }
        .accessibilityIdentifier("pica.mcp.import")
    }

    private var paste: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            Text("An `mcpServers` or `servers` object, a map of names to entries, or one entry. Secrets in it go to the Keychain.")
                .font(Typography.callout).foregroundStyle(Palette.textSecondary)
            TextEditor(text: $store.snippet)
                .font(Typography.code)
                .frame(minHeight: 200)
                .border(Palette.border)
                .accessibilityIdentifier("pica.mcp.import.snippet")
            TextField("Name, if the snippet is one unnamed entry", text: $store.snippetName)
            Button("Check Snippet") { Task { await store.previewSnippet() } }
            candidateList
        }
    }

    private var platforms: some View {
        Group {
            if store.isWorking && store.sources.isEmpty {
                ProgressView()
            } else if store.sources.isEmpty {
                Text("No other app's MCP configuration was found.").font(Typography.callout)
            } else {
                candidateList
            }
        }
    }

    private var candidateList: some View {
        List {
            ForEach(store.sources, id: \.source) { source in
                Section(source.source) {
                    ForEach(source.candidates, id: \.candidateId) { candidate in
                        CandidateRow(candidate: candidate, chosen: chosenBinding(candidate))
                    }
                }
            }
        }
        .frame(minHeight: 140)
    }

    private func chosenBinding(_ candidate: McpImportCandidate) -> Binding<Bool> {
        Binding(
            get: { store.chosen.contains(candidate.candidateId) },
            set: { chosen in
                if chosen { store.chosen.insert(candidate.candidateId) } else { store.chosen.remove(candidate.candidateId) }
            })
    }
}

private struct CandidateRow: View {
    let candidate: McpImportCandidate
    let chosen: Binding<Bool>

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxSmall) {
            Toggle(isOn: chosen) {
                Text("\(candidate.name) → \(candidate.id)").font(Typography.headline)
            }
            .disabled(!candidate.issues.isEmpty)
            ForEach(candidate.issues + candidate.notes, id: \.self) { note in
                Text(note.keyPath.isEmpty ? note.message : "\(note.keyPath): \(note.message)")
                    .font(Typography.caption).foregroundStyle(Palette.textSecondary)
            }
            if !candidate.secretFields.isEmpty {
                Text("Moves \(candidate.secretFields.count) secret(s) to the Keychain.")
                    .font(Typography.caption).foregroundStyle(Palette.textSecondary)
            }
        }
    }
}
