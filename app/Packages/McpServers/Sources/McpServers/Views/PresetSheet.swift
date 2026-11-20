import DesignSystem
import PicaProtocol
import SwiftUI

/// Adds one of the optional presets. A secret parameter takes the secret itself; it goes to the Keychain, and the
/// server is written with a reference to it.
struct PresetSheet: View {
    @State var form: PresetForm
    let store: McpServersStore
    let done: () -> Void
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text("Add \(form.preset.name)").font(Typography.title)
            Text(form.preset.description).font(Typography.callout).foregroundStyle(Palette.textSecondary)
            Form {
                TextField("Server id", text: $form.serverId)
                    .accessibilityIdentifier("pica.mcp.preset.serverId")
                ForEach(form.visibleParameters, id: \.name) { parameter in
                    field(parameter)
                }
            }
            .formStyle(.grouped)
            if let message = store.message {
                Text(message).font(Typography.callout).foregroundStyle(Palette.danger)
                    .accessibilityIdentifier("pica.mcp.preset.error")
            }
            HStack {
                Text(form.problem ?? "").font(Typography.caption).foregroundStyle(Palette.textSecondary)
                Spacer()
                Button("Cancel", action: done).keyboardShortcut(.cancelAction)
                Button("Add Server") {
                    saving = true
                    Task {
                        if await store.addPreset(form) { done() }
                        saving = false
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(form.problem != nil || saving)
                .accessibilityIdentifier("pica.mcp.preset.add")
            }
        }
        .padding(Spacing.large)
        .frame(width: 520)
        .accessibilityIdentifier("pica.mcp.preset")
    }

    @ViewBuilder private func field(_ parameter: McpPresetParameter) -> some View {
        let identifier = "pica.mcp.preset.param.\(parameter.name)"
        switch parameter.kind {
        case .choice:
            Picker(parameter.label, selection: value(parameter)) {
                ForEach(parameter.choices ?? [], id: \.self) { Text($0).tag($0) }
            }
            .help(parameter.description)
            .accessibilityIdentifier(identifier)
        case .secretRef:
            SecureField(parameter.label, text: secret(parameter), prompt: Text("Stored in the Keychain"))
                .help("\(parameter.description) Kept in the Keychain as \(form.secretRef(for: parameter)).")
                .accessibilityIdentifier("pica.mcp.preset.secret.\(parameter.name)")
        case .text, .url, .hostname, .identifier:
            TextField(parameter.label, text: value(parameter), prompt: parameter.examples.first.map { Text($0) })
                .help(parameter.description)
                .accessibilityIdentifier(identifier)
        }
    }

    private func value(_ parameter: McpPresetParameter) -> Binding<String> {
        Binding(get: { form.values[parameter.name] ?? "" }, set: { form.values[parameter.name] = $0 })
    }

    private func secret(_ parameter: McpPresetParameter) -> Binding<String> {
        Binding(get: { form.secrets[parameter.name] ?? "" }, set: { form.secrets[parameter.name] = $0 })
    }
}
