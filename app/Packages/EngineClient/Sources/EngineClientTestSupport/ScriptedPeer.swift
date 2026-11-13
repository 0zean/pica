import EngineClient
import Foundation
import PicaProtocol

/// One accepted client connection. A test reads what the client sent and writes what the engine would answer.
public actor ScriptedPeer {
    /// A line from the client, with the JSON-RPC fields a script checks.
    public struct Message: Decodable, Sendable {
        public var id: RequestId?
        public var method: String?
        public var params: JSONValue?
        public var result: JSONValue?
        public var error: RpcError?
    }

    private let connection: UnixSocketConnection
    private var iterator: AsyncThrowingStream<Data, any Error>.AsyncIterator?
    private let encoder = JSONEncoder()

    init(connection: UnixSocketConnection) {
        self.connection = connection
        iterator = connection.lines.makeAsyncIterator()
    }

    public func receive() async throws -> Message {
        guard var lines = iterator else { throw ScriptError.peerClosed }
        iterator = nil
        let line = try await lines.next(isolation: self)
        iterator = lines
        guard let line else { throw ScriptError.peerClosed }
        return try JSONDecoder().decode(Message.self, from: line)
    }

    /// Receives the next line and checks that it is a request for `method`.
    public func receiveRequest(_ method: String) async throws -> Message {
        let message = try await receive()
        guard message.method == method, message.id != nil else {
            throw ScriptError.unexpected("expected a \(method) request, got \(message.method ?? "a response")")
        }
        return message
    }

    /// Answers the client's `engine.hello`.
    public func acceptHello(engineVersion: String = "test") async throws {
        let hello = try await receiveRequest(Methods.EngineHello.name)
        try respond(to: hello, with: EngineHelloResult(protocolVersion: .current, engineVersion: engineVersion))
    }

    public func respond(to message: Message, with result: some Encodable) throws {
        try send(["jsonrpc": AnyEncodable("2.0"), "id": AnyEncodable(message.id), "result": AnyEncodable(result)])
    }

    public func respond(to message: Message, error: RpcError) throws {
        try send(["jsonrpc": AnyEncodable("2.0"), "id": AnyEncodable(message.id), "error": AnyEncodable(error)])
    }

    public func notify(_ method: String, params: some Encodable) throws {
        try send(["jsonrpc": AnyEncodable("2.0"), "method": AnyEncodable(method), "params": AnyEncodable(params)])
    }

    public func request(id: RequestId, method: String, params: some Encodable) throws {
        try send([
            "jsonrpc": AnyEncodable("2.0"), "id": AnyEncodable(id), "method": AnyEncodable(method),
            "params": AnyEncodable(params),
        ])
    }

    /// Sends an `events.event` notification carrying a minimal event with the given `seq`.
    public func sendEvent(subscriptionId: Id, sessionId: Id, seq: Seq) throws {
        let event = SessionEvent.unknown(
            .init(sessionId: sessionId, seq: seq, timestamp: "2026-11-13T09:00:00.000Z", type: "test.event", payload: .null))
        try notify(Notifications.EventsEvent.name, params: EventsEventNotification(subscriptionId: subscriptionId, event: event))
    }

    public func disconnect() {
        connection.close()
    }

    private func send(_ message: [String: AnyEncodable]) throws {
        var data = try encoder.encode(message)
        data.append(0x0A)
        connection.send(data)
    }
}

private struct AnyEncodable: Encodable {
    private let value: any Encodable

    init(_ value: any Encodable) {
        self.value = value
    }

    func encode(to encoder: any Encoder) throws {
        try value.encode(to: encoder)
    }
}
