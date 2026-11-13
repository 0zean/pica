/// A JSON-RPC method. `Methods` holds one conforming type per method in the protocol.
public protocol PicaMethod {
    associatedtype Params: Codable & Sendable
    associatedtype Result: Codable & Sendable
    static var name: String { get }
    /// `.client` methods are called by a client on the engine; `.engine` methods by the engine on the client.
    static var direction: MethodDirection { get }
}

/// A JSON-RPC notification sent by the engine. `Notifications` holds one conforming type per notification.
public protocol PicaNotification {
    associatedtype Params: Codable & Sendable
    static var name: String { get }
}
