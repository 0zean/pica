import Foundation
import PicaProtocol

/// A new agent, skill or instructions file as the New sheet fills it in, and the file text it becomes. The engine
/// validates the text before writing it (C-02's validator for agents), so what the draft writes is what loads.
public struct NewItemDraft: Equatable, Sendable {
    public var kind: CustomizationKind
    public var locationId: Id?
    public var name = ""
    public var description = ""
    public var tier: Tier = .worker
    /// Comma-separated: Pica's tool names (`view, grep`), Copilot's aliases (`read, search`) or `server/tool`.
    public var tools = "view, grep, glob"
    /// The agent's prompt, the skill's instructions, or the instructions file itself.
    public var body = ""

    public init(kind: CustomizationKind, locationId: Id? = nil) {
        self.kind = kind
        self.locationId = locationId
    }

    public var toolList: [String] {
        tools.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// The file's text. Text values are written as JSON strings, which YAML reads as double-quoted scalars, so a
    /// colon or a quote in a description cannot change the frontmatter.
    public var text: String {
        switch kind {
        case .agent:
            let tools = toolList.map(Self.quoted).joined(separator: ", ")
            return frontmatter([
                "description: \(Self.quoted(description.trimmed))", "tier: \(tier.rawValue)", "tools: [\(tools)]",
            ]) + body.trimmed + "\n"
        case .skill:
            return frontmatter(["name: \(Self.quoted(name.trimmed))", "description: \(Self.quoted(description.trimmed))"])
                + body.trimmed + "\n"
        case .instructions:
            return body.trimmed + "\n"
        }
    }

    /// What is missing before the draft can be created, or nil.
    public func problem(singleFile: Bool) -> String? {
        if locationId == nil { return "Choose where to create it." }
        if !singleFile && name.trimmed.isEmpty { return "Give it a name." }
        if kind != .instructions && description.trimmed.isEmpty { return "Describe it in a sentence." }
        if kind == .agent && toolList.isEmpty { return "List the agent's tools." }
        if body.trimmed.isEmpty { return kind == .agent ? "Write the agent's prompt." : "Write the instructions." }
        return nil
    }

    private func frontmatter(_ lines: [String]) -> String {
        "---\n" + lines.joined(separator: "\n") + "\n---\n\n"
    }

    static func quoted(_ value: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        guard let data = try? encoder.encode(value), let json = String(data: data, encoding: .utf8) else { return "\"\"" }
        return json
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
