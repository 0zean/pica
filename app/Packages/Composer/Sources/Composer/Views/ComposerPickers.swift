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
/// Choosing one writes `routing.tiers` in the user's config.jsonc (`config.set`); sessions started afterwards use it.
/// When a managed policy locks the tiers the menu only shows them and names the policy.
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
                } else {
                    Text("New sessions use the models chosen here.")
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
        let resolved = modelName(assignment.resolvedModelId) ?? "no model available"
        Toggle("Auto (\(resolved))", isOn: binding(assignment, "auto"))
        ForEach(store.models.filter { $0.allowedByPolicy || $0.id == assignment.setting }, id: \.id) { model in
            Toggle(model.name, isOn: binding(assignment, model.id))
        }
    }

    private func binding(_ assignment: TierAssignment, _ setting: String) -> Binding<Bool> {
        Binding(
            get: { assignment.setting == setting },
            set: { if $0 { Task { await store.setTier(assignment.tier, to: setting) } } })
    }

    private var help: String {
        if let lock = store.tierLock { return "Models for the reasoning and worker tiers, locked by managed policy “\(lock)”." }
        return "Models for the reasoning and worker tiers. New sessions use them."
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
