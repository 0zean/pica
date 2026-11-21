import AppKit
import DesignSystem
import PicaProtocol
import SwiftUI

/// Settings ▸ Appearance: config.jsonc's `appearance.theme`, `.density` and `.accent` (docs/themes.md).
struct AppearanceSettingsView: View {
    let store: AppearanceStore

    var body: some View {
        Form {
            Section("Theme") {
                AppearanceRow(store: store, keyPath: AppearanceStore.themeKey, title: "Theme", help: "Colors for every window.") {
                    Picker("Theme", selection: Binding(get: { store.themeId }, set: { id in Task { await store.setTheme(id) } })) {
                        ForEach(store.library.themes) { Text($0.name).tag($0.id) }
                        if let missing = store.missingTheme { Text(missing).tag(missing) }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
                if let missing = store.missingTheme {
                    Label("No valid theme file “\(missing).jsonc”; Pica's own colors are shown.", systemImage: "exclamationmark.triangle")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.warning)
                }
                ForEach(store.library.problems) { problem in
                    Label("\(problem.file): \(problem.message)", systemImage: "exclamationmark.triangle")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.danger)
                        .accessibilityIdentifier("pica.settings.appearance.problem.\(problem.file)")
                }
                HStack {
                    Button("Show Themes Folder") { revealThemesFolder() }
                    Button("Reload Themes") { Task { await store.load() } }
                }
                .buttonStyle(.link)
                .font(Typography.caption)
            }
            Section("Layout") {
                AppearanceRow(store: store, keyPath: AppearanceStore.densityKey, title: "Density", help: "Room around controls, rows and cards.") {
                    Picker("Density", selection: Binding(get: { store.density }, set: { density in Task { await store.setDensity(density) } })) {
                        ForEach(Density.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                }
            }
            Section("Accent") {
                AppearanceRow(store: store, keyPath: AppearanceStore.accentKey, title: "Accent color", help: "Buttons, links and selection, over the theme's accent.") {
                    AccentPicker(store: store)
                }
                if let warning = accentWarning {
                    Label(warning, systemImage: "exclamationmark.triangle")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.warning)
                }
            }
            Section("Preview") {
                AppearancePreview()
                    .picaAppearance(theme: store.theme, density: store.density)
            }
        }
        .formStyle(.grouped)
        .task { await store.load() }
    }

    /// The accent is drawn as text and as marks on the background, which need 3:1 at the least.
    private var accentWarning: String? {
        guard let accent = store.accent else { return nil }
        let theme = store.theme
        let worst = [Appearance.light, .dark]
            .map { accent.contrast(with: Palette.background.rgb(for: $0, in: theme)) }
            .min() ?? 21
        guard worst < 3 else { return nil }
        return String(format: "%@ has %.1f:1 contrast with the background in one appearance; text in it may be hard to read.", accent.description, worst)
    }

    private func revealThemesFolder() {
        try? FileManager.default.createDirectory(at: store.directory, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([store.directory])
    }
}

/// A labelled control with its lock line, its "Use Default" link and its problem, like the General pane's rows.
private struct AppearanceRow<Control: View>: View {
    let store: AppearanceStore
    let keyPath: String
    let title: String
    let help: String
    @ViewBuilder let control: Control

    var body: some View {
        let lock = store.locks[keyPath]
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            LabeledContent {
                control
                    .disabled(lock != nil)
                    .accessibilityIdentifier("pica.settings.\(keyPath)")
            } label: {
                Text(title)
                Text(help)
            }
            if let lock {
                Label(lock, systemImage: "lock.fill")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityIdentifier("pica.settings.lock.\(keyPath)")
            } else if store.layers[keyPath] == .user {
                Button("Use Default") { Task { await store.reset(keyPath) } }
                    .buttonStyle(.link)
                    .font(Typography.caption)
            }
            if let problem = store.problems[keyPath] {
                Text(problem)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.danger)
            }
        }
    }
}

/// The system color panel, writing the chosen color once the user has stopped moving it for a moment.
private struct AccentPicker: View {
    let store: AppearanceStore
    @Environment(\.self) private var environment
    @State private var pending: Task<Void, Never>?

    var body: some View {
        ColorPicker("Accent color", selection: binding, supportsOpacity: false)
            .labelsHidden()
    }

    private var binding: Binding<Color> {
        Binding(
            get: { (store.accent ?? Palette.accent.rgb(for: Appearance(environment), in: store.theme)).color },
            set: { color in
                let resolved = color.resolve(in: environment)
                let rgb = RGB(red: Double(resolved.red), green: Double(resolved.green), blue: Double(resolved.blue))
                pending?.cancel()
                pending = Task {
                    try? await Task.sleep(for: .milliseconds(300))
                    guard !Task.isCancelled, rgb != store.accent else { return }
                    await store.setAccent(rgb)
                }
            })
    }
}

/// A few components drawn with the chosen theme and density.
private struct AppearancePreview: View {
    @Environment(\.picaDensity) private var density

    var body: some View {
        VStack(alignment: .leading, spacing: density.spacing(Spacing.small)) {
            HStack(spacing: density.spacing(Spacing.small)) {
                Button("New session") {}.buttonStyle(.pica(.primary))
                Button("Open repository") {}.buttonStyle(.pica(.secondary))
                Chip("Working", systemImage: "sparkles", tone: .accent)
                ActivityMark(isWorking: false, progress: 0.6).frame(width: 20, height: 20)
            }
            Card {
                Text("Refactor the session store")
                    .font(Typography.headline)
                    .foregroundStyle(Palette.textPrimary)
            }
        }
        .padding(density.spacing(Spacing.small))
        .background(Palette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.settings.appearance.preview")
    }
}
