import DesignSystem
import PicaProtocol
import SwiftUI

/// The routing profile. A session keeps the profile it started with (the engine sets it at `session.create`), so the
/// menu shows this session's and sets the one new sessions in the workspace start with.
struct ProfilePicker: View {
    let store: ComposerStore

    var body: some View {
        Menu {
            Section("This session") {
                Text(Self.title(store.session.routingProfile))
            }
            Section("New sessions in this workspace") {
                ForEach(RoutingProfile.allCases, id: \.self) { profile in
                    Toggle(Self.title(profile), isOn: Binding(
                        get: { store.defaultProfile == profile },
                        set: { if $0 { Task { await store.setDefaultProfile(profile) } } }))
                }
            }
        } label: {
            Label(Self.title(store.session.routingProfile), systemImage: "arrow.triangle.branch")
                .font(Typography.caption)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .fixedSize()
        .help("Routing profile. A session keeps the profile it started with.")
        .accessibilityIdentifier("pica.composer.profile")
    }

    static func title(_ profile: RoutingProfile) -> String {
        switch profile {
        case .off: "Off"
        case .balanced: "Balanced"
        case .strict: "Strict"
        }
    }
}

/// The models the reasoning and worker tiers run on (`models.tiers`): each tier's setting and the model it resolves to.
/// The engine does not serve `config.set` yet, so the menu shows them and says where to change them; sessions started
/// afterwards use a changed setting.
struct TierPicker: View {
    let store: ComposerStore

    var body: some View {
        Menu {
            ForEach(store.tiers, id: \.tier) { assignment in
                Section(Self.title(assignment.tier)) {
                    Text(describe(assignment))
                }
            }
            Section {
                Text("Set routing.tiers in config.jsonc to change them.")
            }
        } label: {
            Label(label, systemImage: "cpu")
                .font(Typography.caption)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .fixedSize()
        .disabled(store.tiers.isEmpty)
        .help("Models for the reasoning and worker tiers. New sessions use them.")
        .accessibilityIdentifier("pica.composer.tiers")
    }

    private var label: String {
        guard let reasoning = store.tiers.first(where: { $0.tier == .reasoning }) else { return "Tiers" }
        return modelName(reasoning.resolvedModelId) ?? reasoning.setting
    }

    private func describe(_ assignment: TierAssignment) -> String {
        let model = modelName(assignment.resolvedModelId) ?? "no model available"
        return assignment.setting == "auto" ? "Auto: \(model)" : model
    }

    private func modelName(_ id: Id?) -> String? {
        id.map { id in store.models.first { $0.id == id }?.name ?? id }
    }

    static func title(_ tier: Tier) -> String {
        switch tier {
        case .reasoning: "Reasoning tier"
        case .worker: "Worker tier"
        }
    }
}
