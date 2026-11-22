import EngineClient
import Foundation
import PicaProtocol

/// What New Session offers for the session's mode and models (docs/workspaces.md): the profile the workspace's
/// sessions start with, each tier's current setting, the models a tier can run on, and what managed policy locks.
public struct NewSessionRouting: Equatable, Sendable {
    /// The workspace's `routing.profile` override unless policy locks the key, else the config's (D-22).
    public var defaultProfile: RoutingProfile
    /// The managed policy that locks `routing.profile`, if one does.
    public var profileLock: String?
    public var models: [ModelInfo]
    /// Each tier's setting in the config (`models.tiers`) and the model it resolves to.
    public var tiers: [TierAssignment]
    /// The managed policy that locks a tier's setting, per tier.
    public var tierLocks: [Tier: String]

    public init(
        defaultProfile: RoutingProfile, profileLock: String? = nil, models: [ModelInfo] = [],
        tiers: [TierAssignment] = [], tierLocks: [Tier: String] = [:]
    ) {
        self.defaultProfile = defaultProfile
        self.profileLock = profileLock
        self.models = models
        self.tiers = tiers
        self.tierLocks = tierLocks
    }

    public func setting(_ tier: Tier) -> String {
        tiers.first { $0.tier == tier }?.setting ?? "auto"
    }

    /// The model a tier resolves to now, by name.
    public func resolvedName(_ tier: Tier) -> String? {
        tiers.first { $0.tier == tier }?.resolvedModelId.map(modelName)
    }

    public func modelName(_ id: Id) -> String {
        models.first { $0.id == id }?.name ?? id
    }
}

extension EngineWorkspacesBackend {
    static func loadRouting(client: EngineClient, workspaceId: Id) async throws -> NewSessionRouting {
        async let profileValue = client.request(Methods.ConfigGet.self, ConfigGetParams(keyPath: "routing.profile")).value
        async let workspace = client.request(Methods.WorkspaceGet.self, ById(id: workspaceId)).workspace
        // A catalog the engine cannot list leaves the tier pickers on their settings only.
        async let models = try? client.request(Methods.ModelsList.self).models
        async let tiers = try? client.request(Methods.ModelsTiers.self).tiers
        var tierLocks: [Tier: String] = [:]
        for tier in Tier.allCases {
            let value = try? await client.request(
                Methods.ConfigGet.self, ConfigGetParams(keyPath: "routing.tiers.\(tier.rawValue)")
            ).value
            if let value, value.locked { tierLocks[tier] = value.lockedBy ?? "managed policy" }
        }
        let profile = try await profileValue
        let configured: RoutingProfile = if case .string(let raw) = profile.value, let parsed = RoutingProfile(rawValue: raw) {
            parsed
        } else {
            .off
        }
        let override = profile.locked ? nil : try await workspace.overrides.routingProfile
        return NewSessionRouting(
            defaultProfile: override ?? configured,
            profileLock: profile.locked ? (profile.lockedBy ?? "managed policy") : nil,
            models: await models ?? [], tiers: await tiers ?? [], tierLocks: tierLocks)
    }
}
