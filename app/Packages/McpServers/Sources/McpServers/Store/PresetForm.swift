import Foundation
import PicaProtocol

/// The form for adding one of the optional presets (M-02). Secret parameters take the secret itself, which is stored
/// in the Keychain under the parameter's reference; the preset is rendered with the reference only.
public struct PresetForm: Hashable, Sendable {
    public let preset: McpPreset
    public var serverId: String
    public var scope: McpScope
    /// Text and choice values, and secret references, by parameter name.
    public var values: [String: String]
    /// Secrets typed for `secretRef` parameters, by parameter name. Never filled from storage.
    public var secrets: [String: String] = [:]

    public init(preset: McpPreset, scope: McpScope) {
        self.preset = preset
        serverId = preset.id
        self.scope = scope
        values = Dictionary(uniqueKeysWithValues: preset.parameters.compactMap { parameter in
            parameter.default.map { (parameter.name, $0) }
        })
    }

    /// The parameters that apply with the values chosen so far.
    public var visibleParameters: [McpPresetParameter] {
        preset.parameters.filter { parameter in
            guard let condition = parameter.onlyWhen else { return true }
            return condition.values.contains(values[condition.parameter] ?? "")
        }
    }

    public var problem: String? {
        if !ServerDraft.isValidId(serverId) { return "The id must start with a letter or digit and use only letters, digits, ., _ and -." }
        for parameter in visibleParameters where parameter.required {
            if parameter.kind == .secretRef {
                if (secrets[parameter.name] ?? "").isEmpty { return "Enter the \(parameter.label.lowercased())." }
            } else if (values[parameter.name] ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
                return "Give the \(parameter.label.lowercased())."
            }
        }
        return nil
    }

    /// Where each secret parameter's value is kept: its default reference, else one under the server's id.
    public func secretRef(for parameter: McpPresetParameter) -> String {
        values[parameter.name] ?? ServerDraft.secretRef(serverId: serverId, field: parameter.name)
    }

    /// What `mcp.renderPreset` receives: visible parameters only, secrets as references.
    public var renderParameters: [String: String] {
        var rendered: [String: String] = [:]
        for parameter in visibleParameters {
            if parameter.kind == .secretRef {
                rendered[parameter.name] = secretRef(for: parameter)
            } else if let value = values[parameter.name], !value.isEmpty {
                rendered[parameter.name] = value
            }
        }
        return rendered
    }

    /// The secrets to store before the server is added.
    public var enteredSecrets: [(ref: String, value: String)] {
        visibleParameters.compactMap { parameter in
            guard parameter.kind == .secretRef, let value = secrets[parameter.name], !value.isEmpty else { return nil }
            return (secretRef(for: parameter), value)
        }
    }
}
