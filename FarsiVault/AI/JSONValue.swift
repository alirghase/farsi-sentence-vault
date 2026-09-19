import Foundation

/// A minimal encodable JSON tree.
///
/// Exists because Gemini's `responseSchema` is an arbitrary JSON object that
/// does not map onto a fixed Swift type. Building it as a typed tree keeps the
/// schema readable and compile-checked rather than a raw string literal that
/// silently breaks when edited.
indirect enum JSONValue: Encodable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }

    static func strings(_ values: [String]) -> JSONValue {
        .array(values.map(JSONValue.string))
    }
}

/// Response schemas, constrained so the model cannot drift outside the closed
/// tag vocabulary. MIRRORS tools/prompts.py.
enum Schemas {
    static let sentenceBatch: JSONValue = .object([
        "type": .string("OBJECT"),
        "properties": .object([
            "sentences": .object([
                "type": .string("ARRAY"),
                "items": .object([
                    "type": .string("OBJECT"),
                    "properties": .object([
                        "englishText": .object(["type": .string("STRING")]),
                        "farsiText": .object(["type": .string("STRING")]),
                        "finglish": .object(["type": .string("STRING")]),
                        "literalGloss": .object(["type": .string("STRING")]),
                        "difficulty": .object(["type": .string("INTEGER")]),
                        "situation": .object(["type": .string("STRING")]),
                        "grammarTags": .object([
                            "type": .string("ARRAY"),
                            "items": .object([
                                "type": .string("STRING"),
                                "enum": .strings(ErrorTag.allKeys),
                            ]),
                        ]),
                    ]),
                    "required": .strings([
                        "englishText", "farsiText", "finglish", "literalGloss",
                        "difficulty", "situation", "grammarTags",
                    ]),
                    "propertyOrdering": .strings([
                        "englishText", "farsiText", "finglish", "literalGloss",
                        "difficulty", "situation", "grammarTags",
                    ]),
                ]),
            ])
        ]),
        "required": .strings(["sentences"]),
    ])

    static let gradeBatch: JSONValue = .object([
        "type": .string("OBJECT"),
        "properties": .object([
            "grades": .object([
                "type": .string("ARRAY"),
                "items": .object([
                    "type": .string("OBJECT"),
                    "properties": .object([
                        "attemptId": .object(["type": .string("STRING")]),
                        "transcript": .object(["type": .string("STRING")]),
                        "score": .object(["type": .string("INTEGER")]),
                        "verdict": .object([
                            "type": .string("STRING"),
                            "enum": .strings(["correct", "minor", "major", "wrong"]),
                        ]),
                        "feedback": .object(["type": .string("STRING")]),
                        "correctedFarsi": .object(["type": .string("STRING")]),
                        "errorTags": .object([
                            "type": .string("ARRAY"),
                            "items": .object([
                                "type": .string("STRING"),
                                "enum": .strings(ErrorTag.allKeys),
                            ]),
                        ]),
                    ]),
                    "required": .strings([
                        "attemptId", "transcript", "score", "verdict",
                        "feedback", "correctedFarsi", "errorTags",
                    ]),
                    "propertyOrdering": .strings([
                        "attemptId", "transcript", "score", "verdict",
                        "feedback", "correctedFarsi", "errorTags",
                    ]),
                ]),
            ])
        ]),
        "required": .strings(["grades"]),
    ])
}
