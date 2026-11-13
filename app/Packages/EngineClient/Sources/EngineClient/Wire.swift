import Foundation
import PicaProtocol

/// The fields that route an incoming line, decoded before the line is decoded as a specific type.
struct IncomingHeader: Decodable {
    var id: RequestId?
    var method: String?
    var params: Params?

    /// Present on `events.event`; other params decode with both fields nil.
    struct Params: Decodable {
        var subscriptionId: Id?
        var event: EventSeq?
    }

    struct EventSeq: Decodable {
        var seq: Seq
    }
}

struct OutgoingRequest<Params: Encodable>: Encodable {
    let jsonrpc = "2.0"
    let id: RequestId
    let method: String
    let params: Params
}

struct OutgoingResult<Result: Encodable>: Encodable {
    let jsonrpc = "2.0"
    let id: RequestId
    let result: Result
}

struct OutgoingError: Encodable {
    let jsonrpc = "2.0"
    let id: RequestId
    let error: RpcError
}

struct ResponseEnvelope<Result: Decodable>: Decodable {
    var result: Result?
    var error: RpcError?
}

struct ParamsEnvelope<Params: Decodable>: Decodable {
    var params: Params
}

extension JSONEncoder {
    func frame(_ message: some Encodable) throws -> Data {
        var data = try encode(message)
        data.append(0x0A)
        return data
    }
}
