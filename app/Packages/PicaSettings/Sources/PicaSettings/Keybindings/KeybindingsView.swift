import AppKit
import DesignSystem
import SwiftUI

/// The keybinding editor: each action with its shortcut. Click a shortcut and press the new keys; ⎋ cancels and ⌫
/// leaves the action without one.
struct KeybindingsView: View {
    let store: KeybindingStore
    let registry: ActionRegistry

    var body: some View {
        Form {
            if let lock = store.lock {
                Label(lock, systemImage: "lock.fill")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityIdentifier("pica.keybindings.lock")
            }
            Section {
                ForEach(registry.definitions) { definition in
                    LabeledContent(definition.title) {
                        HStack(spacing: Spacing.small) {
                            ShortcutRecorder(id: definition.id, store: store)
                                .disabled(store.lock != nil)
                            Button("Reset") { Task { await store.reset(definition.id) } }
                                .buttonStyle(.link)
                                .disabled(store.lock != nil || !store.isCustomized(definition.id))
                                .accessibilityIdentifier("pica.keybindings.reset.\(definition.id.rawValue)")
                        }
                    }
                }
            } footer: {
                VStack(alignment: .leading, spacing: Spacing.xSmall) {
                    if let problem = store.problem {
                        Text(problem)
                            .foregroundStyle(Palette.danger)
                            .accessibilityIdentifier("pica.keybindings.problem")
                    }
                    if !store.ignored.isEmpty {
                        Text("Ignored in config.jsonc: \(store.ignored.joined(separator: ", "))")
                    }
                    Text("Saved under keybindings in config.jsonc. ⌘1–9 and the composer's keys are fixed.")
                }
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecondary)
            }
        }
        .formStyle(.grouped)
    }
}

/// A button showing a shortcut; clicked, it records the next key press.
struct ShortcutRecorder: View {
    let id: ActionID
    let store: KeybindingStore
    @State private var monitor: Any?

    var body: some View {
        Button {
            monitor == nil ? startRecording() : stopRecording()
        } label: {
            Text(label)
                .font(Typography.code)
                .frame(minWidth: 110)
        }
        .accessibilityIdentifier("pica.keybindings.\(id.rawValue)")
        .accessibilityValue(store.shortcut(for: id)?.description ?? "")
        .onDisappear(perform: stopRecording)
    }

    private var label: String {
        if monitor != nil { return "Press keys…" }
        return store.shortcut(for: id)?.displayString ?? "None"
    }

    private func startRecording() {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            MainActor.assumeIsolated { record(event) }
            return nil
        }
    }

    private func stopRecording() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    private func record(_ event: NSEvent) {
        let plain = event.modifierFlags.isDisjoint(with: [.command, .control, .option, .shift])
        if plain, event.keyCode == 53 {
            stopRecording()
            return
        }
        if plain, event.keyCode == 51 {
            stopRecording()
            Task { await store.rebind(id, to: nil) }
            return
        }
        guard let shortcut = Shortcut(event: event) else { return }
        stopRecording()
        Task { await store.rebind(id, to: shortcut) }
    }
}
