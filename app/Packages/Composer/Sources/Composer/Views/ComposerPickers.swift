import DesignSystem
import PicaProtocol
import SwiftUI

/// The session's mode (its routing profile). Choosing one switches this session (`session.setRouting`): the engine
/// takes it while the session is idle or stopped, and the label then shows the new mode. The default that new
/// sessions in the workspace start with is a separate, labelled section. A managed-policy lock shows the mode only.
struct ProfilePicker: View {
    let store: ComposerStore

    var body: some View {
        Menu {
            Section("This session’s mode") {
                if let lock = store.profileLock {
                    Text(Self.title(store.session.routingProfile))
                    Label("Locked by managed policy “\(lock)”", systemImage: "lock.fill")
                } else {
                    ForEach(RoutingProfile.allCases, id: \.self) { profile in
                        Toggle(Self.title(profile), isOn: Binding(
                            get: { store.session.routingProfile == profile },
                            set: { if $0 { Task { await store.setProfile(profile) } } }))
                            .disabled(!store.canChangeRouting)
                    }
                    if !store.canChangeRouting, !store.isChangingRouting {
                        Text("Wait for the turn to finish to change the mode.")
                    }
                }
            }
            if store.profileLock == nil {
                Section("Default for new sessions in this workspace") {
                    ForEach(RoutingProfile.allCases, id: \.self) { profile in
                        Toggle(Self.title(profile), isOn: Binding(
                            get: { store.defaultProfile == profile },
                            set: { if $0 { Task { await store.setDefaultProfile(profile) } } }))
                    }
                }
            }
        } label: {
            Label(Self.title(store.session.routingProfile), systemImage: store.profileLock == nil ? "arrow.triangle.branch" : "lock.fill")
                .font(Typography.caption)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .fixedSize()
        .help("This session’s mode (routing profile). Changes apply from the next turn.")
        .accessibilityLabel("Mode: \(Self.title(store.session.routingProfile))")
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

/// The models this session's reasoning and worker tiers run on. Each tier follows the setting in Settings
/// (`routing.tiers`, shown with the model it resolves to by `models.tiers`) unless the session sets its own; choosing
/// one changes this session (`session.setRouting`), from the next turn, while it is idle or stopped. When a managed
/// policy locks the tiers the menu only shows them and names the policy.
struct TierPicker: View {
    let store: ComposerStore

    var body: some View {
        Menu {
            ForEach(store.tiers, id: \.tier) { assignment in
                Section(Self.title(assignment.tier)) {
                    if store.tierLock != nil {
                        Text(describe(assignment))
                    } else {
                        choices(for: assignment)
                    }
                }
            }
            Section {
                if let lock = store.tierLock {
                    Label("Locked by managed policy “\(lock)”", systemImage: "lock.fill")
                } else if !store.canChangeRouting, !store.isChangingRouting {
                    Text("Wait for the turn to finish to change this session’s models.")
                } else {
                    Text("Changes this session from its next turn. Settings holds the defaults for new sessions.")
                }
            }
        } label: {
            Label(label, systemImage: store.tierLock == nil ? "cpu" : "lock.fill")
                .font(Typography.caption)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .fixedSize()
        .disabled(store.tiers.isEmpty)
        .help(help)
        .accessibilityIdentifier("pica.composer.tiers")
    }

    @ViewBuilder
    private func choices(for assignment: TierAssignment) -> some View {
        let own = store.sessionTier(assignment.tier)
        Toggle("Settings default (\(describe(assignment)))", isOn: binding(assignment.tier, nil))
            .disabled(!store.canChangeRouting)
        Toggle("Auto", isOn: binding(assignment.tier, "auto"))
            .disabled(!store.canChangeRouting)
        ForEach(store.models.filter { $0.allowedByPolicy || $0.id == own }, id: \.id) { model in
            Toggle(model.name, isOn: binding(assignment.tier, model.id))
                .disabled(!store.canChangeRouting)
        }
    }

    private func binding(_ tier: Tier, _ setting: String?) -> Binding<Bool> {
        Binding(
            get: { store.sessionTier(tier) == setting },
            set: { if $0 { Task { await store.setTier(tier, to: setting) } } })
    }

    private var help: String {
        if let lock = store.tierLock { return "Models for the reasoning and worker tiers, locked by managed policy “\(lock)”." }
        return "This session’s models for the reasoning and worker tiers."
    }

    /// The reasoning tier's model for this session.
    private var label: String {
        switch store.sessionTier(.reasoning) {
        case "auto"?: return "Auto"
        case let id?: return modelName(id) ?? id
        case nil:
            guard let reasoning = store.tiers.first(where: { $0.tier == .reasoning }) else { return "Tiers" }
            return modelName(reasoning.resolvedModelId) ?? reasoning.setting
        }
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
