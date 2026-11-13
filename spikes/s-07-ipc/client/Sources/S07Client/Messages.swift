import Foundation

struct StartRequest: Encodable {
    struct Params: Encodable {
        let count: Int
        let rate: Int
    }

    let jsonrpc = "2.0"
    let id = 1
    let method = "spike.start"
    let params: Params
}

struct StartResponse: Decodable {
    struct Result: Decodable {
        let serverNs: String
    }

    let id: Int
    let result: Result
}

struct DeltaData: Decodable {
    let messageId: String
    let text: String
}

struct UsageData: Decodable {
    let model: String
    let inputTokens: Int
    let cachedInputTokens: Int
    let outputTokens: Int
}

struct ToolCompletedData: Decodable {
    let toolCallId: String
    let toolName: String
    let ok: Bool
    let output: String
}

enum EventData {
    case assistantDelta(DeltaData)
    case assistantUsage(UsageData)
    case toolCompleted(ToolCompletedData)
    case unknown(String)
}

struct SessionEvent: Decodable {
    let sessionId: String
    let seq: Int
    let ts: String
    let sentNs: String
    let data: EventData

    private enum CodingKeys: String, CodingKey {
        case sessionId, seq, ts, type, data, sentNs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try container.decode(String.self, forKey: .sessionId)
        seq = try container.decode(Int.self, forKey: .seq)
        ts = try container.decode(String.self, forKey: .ts)
        sentNs = try container.decode(String.self, forKey: .sentNs)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "assistant.delta":
            data = .assistantDelta(try container.decode(DeltaData.self, forKey: .data))
        case "assistant.usage":
            data = .assistantUsage(try container.decode(UsageData.self, forKey: .data))
        case "tool.completed":
            data = .toolCompleted(try container.decode(ToolCompletedData.self, forKey: .data))
        default:
            data = .unknown(type)
        }
    }
}

struct DoneParams: Decodable {
    let sent: Int
    let seconds: Double
}

enum Notification: Decodable {
    case event(SessionEvent)
    case done(DoneParams)

    private enum CodingKeys: String, CodingKey {
        case method, params
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let method = try container.decode(String.self, forKey: .method)
        switch method {
        case "session.event":
            self = .event(try container.decode(SessionEvent.self, forKey: .params))
        case "spike.done":
            self = .done(try container.decode(DoneParams.self, forKey: .params))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .method, in: container, debugDescription: "unexpected method \(method)")
        }
    }
}
