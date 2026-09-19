import Foundation

// MARK: - Transfer types

/// A sentence as returned by generation, before it becomes a SwiftData model.
struct GeneratedSentence: Decodable, Sendable {
    let englishText: String
    let farsiText: String
    let finglish: String
    let literalGloss: String
    let difficulty: Int
    let situation: String
    let grammarTags: [String]
}

/// One attempt handed to the grader.
struct GradingItem: Sendable {
    let id: UUID
    let englishText: String
    let referenceFarsi: String
    let learnerText: String?
    let audioURL: URL?
}

struct Grade: Decodable, Sendable {
    let attemptId: String
    let transcript: String
    let score: Int
    let verdict: String
    let feedback: String
    let correctedFarsi: String
    let errorTags: [String]

    var parsedVerdict: GradeVerdict { GradeVerdict(rawValue: verdict) ?? .major }
    var parsedTags: [ErrorTag] { errorTags.compactMap(ErrorTag.init(rawValue:)) }
}

enum GeminiError: LocalizedError {
    case missingAPIKey
    case http(Int, String)
    case blocked(String)
    case truncated(String)
    case invalidJSON(String)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey:
            "No Gemini API key. Add one in Settings — get a free key at aistudio.google.com/apikey."
        case .http(let code, let detail):
            "Gemini returned HTTP \(code). \(detail)"
        case .blocked(let reason):
            "Gemini declined to respond (\(reason))."
        case .truncated(let reason):
            "Gemini's reply was cut off (\(reason)). Try a smaller batch size."
        case .invalidJSON(let detail):
            "Gemini returned malformed JSON. \(detail)"
        case .network(let detail):
            "Network problem: \(detail)"
        }
    }
}

// MARK: - Client

/// Talks to the Gemini REST API directly over HTTPS.
///
/// Deliberately plain networking: free Apple Developer accounts cannot use
/// iCloud, Push, or App Group entitlements, so any design routing through those
/// would not run on a sideloaded build. HTTPS needs no entitlement.
///
/// An actor because the pacer below is shared mutable state — the free tier
/// allows ~15 requests/minute and a burst of concurrent grading calls would
/// trip it.
actor GeminiClient {
    static let defaultModel = "gemini-3.6-flash"

    /// Free tier is 15 RPM. Stay under with margin rather than relying on retries.
    private static let minInterval: TimeInterval = 4.5
    private static let maxRetries = 4

    private let model: String
    private let session: URLSession
    private let apiKeyProvider: @Sendable () -> String?
    private var lastRequestAt: Date?

    init(
        model: String = GeminiClient.defaultModel,
        session: URLSession = .shared,
        apiKeyProvider: @escaping @Sendable () -> String? = { Keychain.geminiAPIKey }
    ) {
        self.model = model
        self.session = session
        self.apiKeyProvider = apiKeyProvider
    }

    // MARK: Public API

    func generateSentences(
        count: Int,
        situations: [String],
        difficultyMix: [Int: Int],
        focusTags: [ErrorTag],
        avoid: [String]
    ) async throws -> [GeneratedSentence] {
        let user = Prompts.generationUser(
            count: count,
            situations: situations,
            difficultyMix: difficultyMix,
            focusTags: focusTags,
            avoid: avoid
        )
        let data = try await send(
            parts: [.object(["text": .string(user)])],
            system: Prompts.generationSystem,
            schema: Schemas.sentenceBatch,
            temperature: 1.15   // variety matters more than determinism here
        )
        struct Envelope: Decodable { let sentences: [GeneratedSentence] }
        return try decode(Envelope.self, from: data).sentences
    }

    func grade(_ items: [GradingItem]) async throws -> [Grade] {
        var parts: [JSONValue] = [.object(["text": .string(Prompts.gradingUser(items))])]

        // Audio clips follow the text part, in the same order as the items that
        // reference them. The prompt tells the model to expect this ordering.
        for item in items {
            guard let url = item.audioURL else { continue }
            let bytes = try Data(contentsOf: url)
            parts.append(.object([
                "inline_data": .object([
                    "mime_type": .string("audio/mp4"),
                    "data": .string(bytes.base64EncodedString()),
                ])
            ]))
        }

        let data = try await send(
            parts: parts,
            system: Prompts.gradingSystem,
            schema: Schemas.gradeBatch,
            temperature: 0.2   // grading should be stable, unlike generation
        )
        struct Envelope: Decodable { let grades: [Grade] }
        return try decode(Envelope.self, from: data).grades
    }

    // MARK: Transport

    private func send(
        parts: [JSONValue],
        system: String,
        schema: JSONValue,
        temperature: Double
    ) async throws -> Data {
        guard let key = apiKeyProvider(), !key.isEmpty else {
            throw GeminiError.missingAPIKey
        }

        let body = JSONValue.object([
            "contents": .array([.object([
                "role": .string("user"),
                "parts": .array(parts),
            ])]),
            "systemInstruction": .object(["parts": .array([.object(["text": .string(system)])])]),
            "generationConfig": .object([
                "temperature": .double(temperature),
                "responseMimeType": .string("application/json"),
                "responseSchema": schema,
            ]),
        ])
        let payload = try JSONEncoder().encode(body)

        var url = URLComponents(
            string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent"
        )!
        url.queryItems = [URLQueryItem(name: "key", value: key)]

        var request = URLRequest(url: url.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = payload
        request.timeoutInterval = 180

        var delay: TimeInterval = 2
        var lastError: Error = GeminiError.network("no attempt made")

        for attempt in 1...Self.maxRetries {
            await pace()
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw GeminiError.network("non-HTTP response")
                }
                if http.statusCode == 200 {
                    return try extractText(from: data)
                }
                let detail = String(data: data, encoding: .utf8)?.prefix(300) ?? ""
                let error = GeminiError.http(http.statusCode, String(detail))
                // 429 rate limit, 5xx transient. Anything else is our bug — fail fast.
                guard [429, 500, 502, 503, 504].contains(http.statusCode) else { throw error }
                lastError = error
            } catch let error as GeminiError {
                throw error
            } catch {
                lastError = GeminiError.network(error.localizedDescription)
            }

            if attempt < Self.maxRetries {
                try? await Task.sleep(for: .seconds(delay))
                delay = min(delay * 2, 60)
            }
        }
        throw lastError
    }

    /// Enforce a minimum gap between requests to stay under the free-tier RPM cap.
    private func pace() async {
        if let last = lastRequestAt {
            let elapsed = Date.now.timeIntervalSince(last)
            if elapsed < Self.minInterval {
                try? await Task.sleep(for: .seconds(Self.minInterval - elapsed))
            }
        }
        lastRequestAt = .now
    }

    /// Pull the JSON payload out of the Gemini envelope.
    private func extractText(from data: Data) throws -> Data {
        struct Response: Decodable {
            struct Candidate: Decodable {
                struct Content: Decodable {
                    struct Part: Decodable { let text: String? }
                    let parts: [Part]?
                }
                let content: Content?
                let finishReason: String?
            }
            struct PromptFeedback: Decodable { let blockReason: String? }
            let candidates: [Candidate]?
            let promptFeedback: PromptFeedback?
        }

        let response = try JSONDecoder().decode(Response.self, from: data)

        guard let candidate = response.candidates?.first else {
            throw GeminiError.blocked(response.promptFeedback?.blockReason ?? "no candidates")
        }
        if let reason = candidate.finishReason, reason != "STOP" {
            // MAX_TOKENS here means truncated JSON, which would otherwise fail
            // to parse with a far less obvious error. Surface the real cause.
            throw GeminiError.truncated(reason)
        }
        let text = (candidate.content?.parts ?? [])
            .compactMap(\.text)
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !text.isEmpty, let out = text.data(using: .utf8) else {
            throw GeminiError.invalidJSON("empty response text")
        }
        return out
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            let preview = String(data: data, encoding: .utf8)?.prefix(300) ?? ""
            throw GeminiError.invalidJSON("\(error.localizedDescription) — \(preview)")
        }
    }
}
