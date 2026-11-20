import Foundation
import PicaProtocol

/// One header (remote servers) or environment variable (local servers) in the editor.
///
/// A secret is held as a reference to the Keychain item, never as its value: editing a saved server shows that a
/// secret is saved and leaves `entered` empty. Typing into `entered` replaces the saved secret when the server is
/// saved. Nothing here reads a secret back (docs/mcp.md, "Secrets").
public struct DraftField: Identifiable, Hashable, Sendable {
    public enum Value: Hashable, Sendable {
        case plain(String)
        /// `prefix` is text before the secret, such as `Bearer ` in an Authorization header.
        case secret(prefix: String, ref: String?, entered: String)
    }

    public let id: UUID
    public var name: String
    public var value: Value

    public init(name: String, value: Value) {
        id = UUID()
        self.name = name
        self.value = value
    }

    /// Whether a secret is already stored for this field.
    public var hasSavedSecret: Bool {
        if case .secret(_, let ref?, _) = value { return ref.hasPrefix("keychain:") }
        return false
    }
}

/// The add and edit form for a server (docs/mcp.md). `definition(storing:)` turns it back into a `McpServerDef`.
public struct ServerDraft: Hashable, Sendable {
    public enum Kind: String, CaseIterable, Hashable, Sendable {
        case stdio
        case http
        case sse

        public var title: String {
            switch self {
            case .stdio: "Local (stdio)"
            case .http: "Remote (HTTP)"
            case .sse: "Remote (SSE)"
            }
        }
    }

    public var id: String
    public var name: String
    public var scope: McpScope
    public var kind: Kind
    public var command: String
    /// One argument per line.
    public var arguments: String
    public var workingDirectory: String
    public var url: String
    public var fields: [DraftField]
    /// Comma-separated tool names; empty allows every tool.
    public var toolAllowlist: String
    /// False while adding: the id is fixed once the server exists.
    public let isEditing: Bool

    public init(scope: McpScope) {
        id = ""
        name = ""
        self.scope = scope
        kind = .http
        command = ""
        arguments = ""
        workingDirectory = ""
        url = ""
        fields = []
        toolAllowlist = ""
        isEditing = false
    }

    public init(editing server: McpServerDef) {
        id = server.id
        name = server.name
        scope = server.scope
        toolAllowlist = server.toolAllowlist?.joined(separator: ", ") ?? ""
        isEditing = true
        switch server.transport {
        case .stdio(let stdio):
            kind = .stdio
            command = stdio.command
            arguments = stdio.args.joined(separator: "\n")
            workingDirectory = stdio.cwd ?? ""
            url = ""
            fields = stdio.env.sorted { $0.key < $1.key }.map { DraftField(name: $0.key, value: Self.fieldValue($0.value)) }
        case .http(let http):
            kind = http.type == .sse ? .sse : .http
            command = ""
            arguments = ""
            workingDirectory = ""
            url = http.url
            fields = http.headers.sorted { $0.key < $1.key }.map { DraftField(name: $0.key, value: Self.fieldValue($0.value)) }
        }
    }

    public var isRemote: Bool { kind != .stdio }

    /// Why the draft cannot be saved yet, if it cannot.
    public var problem: String? {
        if !isEditing && !Self.isValidId(id) { return "The id must start with a letter or digit and use only letters, digits, ., _ and -." }
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return "Give the server a name." }
        if isRemote && URL(string: url)?.scheme?.hasPrefix("http") != true { return "Give the server's URL." }
        if !isRemote && command.trimmingCharacters(in: .whitespaces).isEmpty { return "Give the command that starts the server." }
        if fields.contains(where: { $0.name.trimmingCharacters(in: .whitespaces).isEmpty }) { return "Every header and variable needs a name." }
        if Set(fields.map(\.name)).count != fields.count { return "Two headers or variables have the same name." }
        for field in fields {
            if case .secret(_, nil, let entered) = field.value, entered.isEmpty { return "Enter the secret for \(field.name)." }
        }
        return nil
    }

    /// The secrets typed into the form, by the reference each is stored under.
    public var enteredSecrets: [(ref: String, value: String)] {
        fields.compactMap { field in
            guard case .secret(_, let ref, let entered) = field.value, !entered.isEmpty else { return nil }
            return (ref ?? Self.secretRef(serverId: id, field: field.name), entered)
        }
    }

    /// The definition the draft describes. Secret fields become references; their values go to the Keychain
    /// separately (`enteredSecrets`).
    public var definition: McpServerDef {
        let allowlist = toolAllowlist.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let transport: McpTransport =
            if isRemote {
                .http(.init(
                    type: kind == .sse ? .sse : .http, url: url.trimmingCharacters(in: .whitespaces),
                    headers: Dictionary(fields.map { ($0.name, headerValue($0)) }, uniquingKeysWith: { _, last in last })))
            } else {
                .stdio(.init(
                    command: command.trimmingCharacters(in: .whitespaces),
                    args: arguments.split(separator: "\n", omittingEmptySubsequences: true).map(String.init),
                    env: Dictionary(fields.map { ($0.name, envValue($0)) }, uniquingKeysWith: { _, last in last }),
                    cwd: workingDirectory.isEmpty ? nil : workingDirectory))
            }
        return McpServerDef(
            id: id, name: name.trimmingCharacters(in: .whitespaces), transport: transport,
            toolAllowlist: allowlist.isEmpty ? nil : allowlist, scope: scope)
    }

    /// Where a secret typed for `field` is kept (docs/secret-references.md).
    public static func secretRef(serverId: String, field: String) -> String {
        "keychain:mcp/\(serverId)/\(field.lowercased())"
    }

    static func isValidId(_ id: String) -> Bool {
        id.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#, options: .regularExpression) != nil
    }

    private func headerValue(_ field: DraftField) -> McpTransport.Http.HeadersValue {
        switch written(field) {
        case .text(let text): .string(text)
        case .reference(let ref): .secretRef(SecretRef(secretRef: ref))
        }
    }

    private func envValue(_ field: DraftField) -> McpTransport.Stdio.EnvValue {
        switch written(field) {
        case .text(let text): .string(text)
        case .reference(let ref): .secretRef(SecretRef(secretRef: ref))
        }
    }

    private enum Written {
        case text(String)
        case reference(String)
    }

    /// A secret on its own is written as a reference; one after a prefix, as a `${secret:…}` placeholder in the text.
    private func written(_ field: DraftField) -> Written {
        switch field.value {
        case .plain(let text):
            return .text(text)
        case .secret(let prefix, let ref, _):
            let ref = ref ?? Self.secretRef(serverId: id, field: field.name)
            return prefix.isEmpty ? .reference(ref) : .text("\(prefix)${secret:\(ref)}")
        }
    }

    /// A value that is, or contains, one secret reference becomes a secret field; anything else stays text.
    static func fieldValue(_ text: String) -> DraftField.Value {
        guard let range = text.range(of: #"\$\{secret:[^}]+\}"#, options: .regularExpression), range.upperBound == text.endIndex
        else { return .plain(text) }
        let ref = String(text[range].dropFirst("${secret:".count).dropLast())
        // An `env:` reference names a variable in the engine's environment; there is no secret here to replace.
        guard ref.hasPrefix("keychain:") else { return .plain(text) }
        return .secret(prefix: String(text[..<range.lowerBound]), ref: ref, entered: "")
    }

    private static func fieldValue(_ value: McpTransport.Http.HeadersValue) -> DraftField.Value {
        switch value {
        case .string(let text): fieldValue(text)
        case .secretRef(let ref): fieldValue("${secret:\(ref.secretRef)}")
        }
    }

    private static func fieldValue(_ value: McpTransport.Stdio.EnvValue) -> DraftField.Value {
        switch value {
        case .string(let text): fieldValue(text)
        case .secretRef(let ref): fieldValue("${secret:\(ref.secretRef)}")
        }
    }
}
