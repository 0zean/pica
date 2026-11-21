import DesignSystem
import PicaProtocol
import SwiftUI

/// Creates an agent, a skill or an instructions file in a location the user picks. The engine checks the text as its
/// readers would before writing it, and says what is wrong if it would not load.
struct NewItemSheet: View {
    @State var draft: NewItemDraft
    let store: CustomizationStore
    let done: () -> Void
    @State private var creating = false

    var body: some View {
        let location = store.locations.first { $0.id == draft.locationId }
        let problem = draft.problem(singleFile: location?.singleFile ?? false)
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text("New \(draft.kind.title)").font(Typography.title)
            Form {
                Section {
                    Picker("Location", selection: $draft.locationId) {
                        ForEach(store.newItemLocations, id: \.id) { location in
                            Text(store.sourceTitle(of: location)).tag(Id?.some(location.id))
                                .disabled(location.lockedBy != nil)
                        }
                    }
                    .accessibilityIdentifier("pica.customization.new.location")
                    if location?.singleFile != true {
                        TextField("Name", text: $draft.name, prompt: Text(draft.kind == .agent ? "changelog-checker" : "release-steps"))
                            .accessibilityIdentifier("pica.customization.new.name")
                    }
                    if draft.kind != .instructions {
                        TextField("Description", text: $draft.description)
                            .accessibilityIdentifier("pica.customization.new.description")
                    }
                    if draft.kind == .agent {
                        Picker("Tier", selection: $draft.tier) {
                            ForEach(Tier.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                        }
                        .accessibilityIdentifier("pica.customization.new.tier")
                        TextField("Tools", text: $draft.tools)
                            .help("Comma-separated: view, grep, glob, create, edit, bash, web_fetch; Copilot's read, search, edit, execute; or server/tool.")
                            .accessibilityIdentifier("pica.customization.new.tools")
                    }
                }
                Section(draft.kind == .agent ? "Prompt" : "Instructions") {
                    TextEditor(text: $draft.body)
                        .font(Typography.code)
                        .frame(minHeight: 140)
                        .accessibilityIdentifier("pica.customization.new.body")
                }
            }
            .formStyle(.grouped)
            if let message = store.message {
                Text(message).font(Typography.callout).foregroundStyle(Palette.danger).textSelection(.enabled)
                    .accessibilityIdentifier("pica.customization.new.error")
            }
            HStack {
                Text(problem ?? "").font(Typography.caption).foregroundStyle(Palette.textSecondary)
                Spacer()
                Button("Cancel", role: .cancel) {
                    store.message = nil
                    done()
                }
                .keyboardShortcut(.cancelAction)
                Button("Create") {
                    creating = true
                    Task {
                        if await store.create(draft) { done() }
                        creating = false
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(problem != nil || creating)
                .accessibilityIdentifier("pica.customization.new.create")
            }
        }
        .padding(Spacing.large)
        .frame(width: 560)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.customization.newSheet")
    }
}
