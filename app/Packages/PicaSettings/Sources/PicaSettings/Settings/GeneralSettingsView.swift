import DesignSystem
import PicaProtocol
import SwiftUI

/// The config.jsonc keys most worth a control. A key a managed policy locks is shown disabled, naming the policy.
struct GeneralSettingsView: View {
    let store: SettingsStore

    var body: some View {
        Form {
            Section("Routing") { rows(SettingsField.routing) }
            Section("Budget") { rows(SettingsField.budget) }
            Section("Permissions") { rows(SettingsField.permissions) }
            Section {
                Text("Saved to config.jsonc in ~/Library/Application Support/Pica, keeping its comments. Every other key is edited in the file.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
        }
        .formStyle(.grouped)
        .task { await store.load() }
    }

    private func rows(_ fields: [SettingsField]) -> some View {
        ForEach(fields) { field in
            SettingsRow(field: field, store: store)
        }
    }
}

private struct SettingsRow: View {
    let field: SettingsField
    let store: SettingsStore

    var body: some View {
        let value = store.value(field.keyPath)
        let lock = store.lock(field.keyPath)
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            LabeledContent {
                control(value)
                    .disabled(value == nil || lock != nil)
                    .accessibilityIdentifier("pica.settings.\(field.keyPath)")
            } label: {
                Text(field.title)
                Text(field.help)
            }
            if let lock {
                Label(lock, systemImage: "lock.fill")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityIdentifier("pica.settings.lock.\(field.keyPath)")
            } else if value?.layer == .user {
                Button("Use Default") { Task { await store.reset(field.keyPath) } }
                    .buttonStyle(.link)
                    .font(Typography.caption)
            }
            if let problem = store.problems[field.keyPath] {
                Text(problem)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.danger)
            }
        }
    }

    @ViewBuilder
    private func control(_ value: ConfigValue?) -> some View {
        switch field.kind {
        case .choice(let choices):
            Picker(field.title, selection: stringBinding(value)) {
                ForEach(choices, id: \.value) { Text($0.title).tag($0.value) }
            }
            .labelsHidden()
            .fixedSize()
        case .tier:
            let current = value?.value.stringValue ?? "auto"
            Picker(field.title, selection: stringBinding(value)) {
                Text("Auto").tag("auto")
                ForEach(store.models.filter { $0.allowedByPolicy || $0.id == current }, id: \.id) { model in
                    Text(model.name).tag(model.id)
                }
                if current != "auto", !store.models.contains(where: { $0.id == current }) {
                    Text(current).tag(current)
                }
            }
            .labelsHidden()
            .fixedSize()
        case .credits:
            CreditsField(value: value?.value.numberValue) { credits in
                Task { await store.set(field.keyPath, to: .number(credits)) }
            }
        }
    }

    private func stringBinding(_ value: ConfigValue?) -> Binding<String> {
        Binding(
            get: { value?.value.stringValue ?? "" },
            set: { next in Task { await store.set(field.keyPath, to: .string(next)) } })
    }
}

/// A number field that writes on ↩ or when it loses focus.
private struct CreditsField: View {
    let value: Double?
    let commit: (Double) -> Void
    @State private var text = ""

    var body: some View {
        TextField("Credits", text: $text)
            .labelsHidden()
            .multilineTextAlignment(.trailing)
            .frame(width: 90)
            .onAppear { text = format(value) }
            .onChange(of: value) { _, next in text = format(next) }
            .onSubmit(write)
    }

    private func write() {
        guard let credits = Double(text.trimmingCharacters(in: .whitespaces)), credits >= 0 else {
            text = format(value)
            return
        }
        if credits != value { commit(credits) }
    }

    private func format(_ value: Double?) -> String {
        guard let value else { return "" }
        return value.rounded() == value ? String(Int(value)) : String(value)
    }
}

extension JSONValue {
    var stringValue: String? {
        if case .string(let text) = self { return text }
        return nil
    }

    var numberValue: Double? {
        if case .number(let number) = self { return number }
        return nil
    }
}
