import Foundation
import PicaProtocol

/// What a row says about an item: where it comes from and whether it is the one that applies.
public struct ItemPresentation: Equatable, Sendable {
    public enum Tone: Sendable {
        case winning
        case applying
        case overridden
        case invalid
    }

    /// "Built-in", "You", "Workspace", or "<repo> · .github/agents".
    public let source: String
    /// "Wins", "Active", "Applies", "Overridden by …" or "Invalid: …".
    public let status: String
    public let tone: Tone
    /// "Locked by managed policy “acme”" when the policy stops Pica editing it.
    public let lock: String?
}

extension CustomizationStore {
    public func presentation(of item: CustomizationItem) -> ItemPresentation {
        ItemPresentation(
            source: sourceTitle(layer: item.layer, locationId: item.locationId, repoId: item.repoId),
            status: statusTitle(item), tone: tone(item),
            lock: item.lockedBy.map { "Locked by managed policy “\($0)”" })
    }

    public func sourceTitle(of location: CustomizationLocation) -> String {
        sourceTitle(layer: location.layer, locationId: location.id, repoId: location.repoId)
    }

    private func sourceTitle(layer: CustomizationLayer, locationId: Id, repoId: Id?) -> String {
        let label = locations.first { $0.id == locationId }?.label
        switch layer {
        case .builtin: return "Built-in"
        case .user: return kind == .agent ? "You" : "You · \(label ?? "")"
        case .workspace: return "Workspace"
        case .repo: return [repoId.flatMap(repoName), label].compactMap(\.self).joined(separator: " · ")
        }
    }

    private func statusTitle(_ item: CustomizationItem) -> String {
        switch item.status {
        case .invalid:
            let first = item.problems.first.map { $0.field.isEmpty ? $0.message : "\($0.field): \($0.message)" }
            return "Invalid: \(first ?? "does not load")"
        case .overridden:
            let winner = items.first { $0.path == item.overriddenBy }
            return "Overridden by \(winner.map { presentation(of: $0).source } ?? item.overriddenBy ?? "another file")"
        case .active:
            if item.kind == .instructions { return "Applies" }
            return items.contains { $0.name == item.name && $0.path != item.path && $0.status == .overridden }
                ? "Wins" : "Active"
        }
    }

    private func tone(_ item: CustomizationItem) -> ItemPresentation.Tone {
        switch item.status {
        case .invalid: .invalid
        case .overridden: .overridden
        case .active: item.kind == .instructions ? .applying : .winning
        }
    }
}
