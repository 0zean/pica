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

/// The models the reasoning and worker tiers run on: `auto` or a model the policy allows. The setting goes to the
/// user's config and applies to sessions started afterwards.
struct TierPicker: View {
    let store: ComposerStore

    var body: some View {
        Menu {
            ForEach([Tier.reasoning, .worker], id: \.self) { tier in
                Section(Self.title(tier)) {
                    Toggle("Auto", isOn: binding(tier, "auto"))
                    ForEach(store.models.filter(\.allowedByPolicy), id: \.id) { model in
                        Toggle(model.name, isOn: binding(tier, model.id))
                    }
                }
            }
        } label: {
            Label(label, systemImage: "cpu")
                .font(Typography.caption)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .fixedSize()
        .help("Models for the reasoning and worker tiers. New sessions use them.")
        .accessibilityIdentifier("pica.composer.tiers")
    }

    private var label: String {
        guard let reasoning = store.tiers.first(where: { $0.tier == .reasoning }) else { return "Tiers" }
        let model = reasoning.resolvedModelId.map { id in store.models.first { $0.id == id }?.name ?? id }
        return reasoning.setting == "auto" ? "Auto" + (model.map { " · \($0)" } ?? "") : (model ?? reasoning.setting)
    }

    private func binding(_ tier: Tier, _ setting: String) -> Binding<Bool> {
        Binding(
            get: { store.tiers.first { $0.tier == tier }?.setting == setting },
            set: { if $0 { Task { await store.setTier(tier, to: setting) } } })
    }

    static func title(_ tier: Tier) -> String {
        switch tier {
        case .reasoning: "Reasoning tier"
        case .worker: "Worker tier"
        }
    }
}
