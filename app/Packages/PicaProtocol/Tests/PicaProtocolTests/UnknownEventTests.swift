import Foundation
import Testing
import PicaProtocol

@Suite struct UnknownEventTests {
    private let futureEvent = Data("""
        {
          "sessionId": "ses_01",
          "seq": 42,
          "timestamp": "2026-11-12T09:30:00.000Z",
          "type": "checkpoint.created",
          "payload": { "checkpointId": "chk_1", "files": ["a.swift"], "bytes": 512 }
        }
        """.utf8)

    @Test func unknownTypeDecodesToUnknownCase() throws {
        let event = try JSONDecoder().decode(SessionEvent.self, from: futureEvent)
        guard case .unknown(let unknown) = event else {
            Issue.record("expected .unknown, got \(event)")
            return
        }
        #expect(event.type == "checkpoint.created")
        #expect(unknown.type == "checkpoint.created")
        #expect(unknown.seq == 42)
        #expect(unknown.sessionId == "ses_01")
        #expect(unknown.payload == .object([
            "checkpointId": .string("chk_1"), "files": .array([.string("a.swift")]), "bytes": .number(512),
        ]))
    }

    @Test func unknownEventReencodesToEqualJSON() throws {
        let result = try roundTrip(SessionEvent.self, futureEvent)
        #expect(result.reencoded == result.original)
    }

    @Test func knownTypeWithWrongPayloadStillFails() {
        let malformed = Data("""
            {"sessionId": "ses_01", "seq": 1, "timestamp": "2026-11-12T09:30:00.000Z",
             "type": "user.message", "payload": {"text": 3, "mode": "send"}}
            """.utf8)
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(SessionEvent.self, from: malformed) }
    }
}
