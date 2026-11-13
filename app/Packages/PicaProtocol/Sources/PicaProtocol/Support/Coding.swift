/// A coding key for any string, used by generated types that have no fields.
struct JSONKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil

    init(stringValue: String) {
        self.stringValue = stringValue
    }

    init?(intValue: Int) {
        nil
    }
}

extension KeyedDecodingContainer {
    /// Generated types call this for fields whose schema allows exactly one value.
    func decodeConstant<Value: Decodable & Equatable>(_ expected: Value, forKey key: Key) throws {
        let value = try decode(Value.self, forKey: key)
        guard value == expected else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "expected \(expected), found \(value)")
        }
    }
}
