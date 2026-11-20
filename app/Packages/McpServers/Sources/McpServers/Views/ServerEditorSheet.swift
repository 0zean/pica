import DesignSystem
import PicaProtocol
import SwiftUI

/// Adds a server by hand or edits one. Headers and environment variables can be secrets: a saved secret shows as
/// saved, never as its value, and typing a new one replaces it.
struct ServerEditorSheet: View {
    @State var draft: ServerDraft
    let store: McpServersStore
    let done: () -> Void
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text(draft.isEditing ? "Edit \(draft.name)" : "Add a Server").font(Typography.title)
            Form {
                Section {
                    TextField("Id", text: $draft.id).disabled(draft.isEditing)
                        .accessibilityIdentifier("pica.mcp.editor.id")
                    TextField("Name", text: $draft.name)
                        .accessibilityIdentifier("pica.mcp.editor.name")
                    Picker("Kind", selection: $draft.kind) {
                        ForEach(ServerDraft.Kind.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    .accessibilityIdentifier("pica.mcp.editor.kind")
                }
                Section {
                    if draft.isRemote {
                        TextField("URL", text: $draft.url, prompt: Text("https://example.com/mcp"))
                            .accessibilityIdentifier("pica.mcp.editor.url")
                    } else {
                        TextField("Command", text: $draft.command).accessibilityIdentifier("pica.mcp.editor.command")
                        TextField("Arguments, one per line", text: $draft.arguments, axis: .vertical)
                            .lineLimit(2...6)
                            .accessibilityIdentifier("pica.mcp.editor.arguments")
                        TextField("Working directory", text: $draft.workingDirectory)
                    }
                    TextField("Tools", text: $draft.toolAllowlist, prompt: Text("All tools"))
                        .help("Comma-separated tool names the server may offer; empty allows every tool.")
                        .accessibilityIdentifier("pica.mcp.editor.tools")
                }
                Section(draft.isRemote ? "Headers" : "Environment") {
                    ForEach($draft.fields) { $field in
                        FieldRow(field: $field) { draft.fields.removeAll { $0.id == field.id } }
                    }
                    HStack {
                        Button("Add Value") { draft.fields.append(DraftField(name: "", value: .plain(""))) }
                        Button("Add Secret") { draft.fields.append(DraftField(name: "", value: .secret(prefix: "", ref: nil, entered: ""))) }
                            .accessibilityIdentifier("pica.mcp.editor.addSecret")
                    }
                    .buttonStyle(.borderless)
                }
            }
            .formStyle(.grouped)
            if let message = store.message {
                Text(message).font(Typography.callout).foregroundStyle(Palette.danger)
                    .accessibilityIdentifier("pica.mcp.editor.error")
            }
            HStack {
                Text(draft.problem ?? "").font(Typography.caption).foregroundStyle(Palette.textSecondary)
                Spacer()
                Button("Cancel", action: done).keyboardShortcut(.cancelAction)
                Button(draft.isEditing ? "Save" : "Add Server") {
                    saving = true
                    Task {
                        if await store.save(draft) { done() }
                        saving = false
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(draft.problem != nil || saving)
                .accessibilityIdentifier("pica.mcp.editor.save")
            }
        }
        .padding(Spacing.large)
        .frame(width: 560)
        .frame(minHeight: 520)
        .accessibilityIdentifier("pica.mcp.editor")
    }
}

/// One header or variable. A secret's field starts empty whether or not one is saved.
private struct FieldRow: View {
    @Binding var field: DraftField
    let remove: () -> Void

    var body: some View {
        HStack(spacing: Spacing.small) {
            TextField("Name", text: $field.name).frame(width: 150)
                .accessibilityIdentifier("pica.mcp.editor.fieldName.\(field.name)")
            switch field.value {
            case .plain(let text):
                TextField("Value", text: Binding(get: { text }, set: { field.value = .plain($0) }))
                    .accessibilityIdentifier("pica.mcp.editor.value.\(field.name)")
            case .secret(let prefix, let ref, let entered):
                if !prefix.isEmpty {
                    Text(prefix.trimmingCharacters(in: .whitespaces)).font(Typography.code)
                }
                SecureField(
                    "Secret",
                    text: Binding(get: { entered }, set: { field.value = .secret(prefix: prefix, ref: ref, entered: $0) }),
                    prompt: Text(field.hasSavedSecret ? "Saved — type to replace" : "Secret")
                )
                .accessibilityIdentifier("pica.mcp.editor.secret.\(field.name)")
                if field.hasSavedSecret {
                    Image(systemName: "key.fill")
                        .foregroundStyle(Palette.success)
                        .help("Saved as \(ref ?? ""). Pica never shows it again.")
                        .accessibilityLabel("Secret saved")
                        .accessibilityIdentifier("pica.mcp.editor.saved.\(field.name)")
                }
            }
            Button(action: remove) { Image(systemName: "minus.circle") }
                .buttonStyle(.borderless)
                .accessibilityLabel("Remove \(field.name)")
        }
    }
}
