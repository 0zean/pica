import Foundation
import Testing
import PicaProtocol

@Suite struct FixtureRoundTripTests {
    @Test func fixturesExist() {
        #expect(Fixtures.all.contains { $0.hasPrefix("events/") })
    }

    @Test(arguments: Fixtures.all)
    func decodesAndReencodesToEqualJSON(_ fixture: String) throws {
        let data = try Fixtures.data(fixture)
        switch fixture.split(separator: "/").first {
        case "events":
            let result = try roundTrip(SessionEvent.self, data)
            #expect(result.reencoded == result.original)
            if case .unknown = result.value {
                Issue.record("\(fixture) has a known type but decoded as unknown")
            }
            #expect(fixture == "events/\(result.value.type).json")
        default:
            Issue.record("no Swift type is mapped to the fixtures in \(fixture); add one to this test")
        }
    }
}
