import Foundation

// MARK: - Wire types

/// An attempt on its way to be graded.
struct OutgoingAttempt: Encodable, Sendable {
    let id: String
    let sentenceId: String
    let direction: String
    let mode: String
    let englishText: String
    let referenceFarsi: String
    /// The tags the sentence exercises. Without these the backend cannot
    /// attribute self-rated attempts to any tag, and speak-aloud practice —
    /// the default mode — would contribute nothing to adaptation.
    let grammarTags: [String]
    let typedAnswer: String?
    let audioBase64: String?
    let selfRating: String?
}

/// A sentence as it arrives from the backend.
struct SentenceDTO: Decodable, Sendable {
    let id: String
    let englishText: String
    let farsiText: String
    let finglish: String
    let literalGloss: String
    let difficulty: Int
    let situation: String
    let grammarTags: [String]
}

struct UsageDTO: Decodable, Sendable {
    let generate: Int?
    let grade: Int?
}

struct SyncResult: Decodable, Sendable {
    let grades: [Grade]
    let sentences: [SentenceDTO]
    let focusTags: [String]
    let usage: UsageDTO?
    let warnings: [String]

    static let empty = SyncResult(
        grades: [], sentences: [], focusTags: [], usage: nil, warnings: []
    )
}

// MARK: - Protocol

/// The one network boundary in the app.
///
/// Two implementations exist so the backend is swappable rather than baked in:
/// `RemoteBrain` (Cloud Run, the normal path) and `DirectGeminiBrain` (phone
/// straight to Gemini, a fallback for when the backend is down or not yet
/// deployed). Everything above this protocol is offline and knows nothing about
/// either.
protocol Brain: Sendable {
    func sync(
        attempts: [OutgoingAttempt],
        wantSentences: Int,
        since: Date?
    ) async throws -> SyncResult
}

enum BrainError: LocalizedError {
    case notConfigured
    case badURL(String)
    case http(Int, String)
    case decoding(String)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            "Backend not set up. Add the service URL and token in Settings."
        case .badURL(let raw):
            "'\(raw)' is not a valid URL."
        case .http(401, _):
            "The backend rejected the token. Check it in Settings."
        case .http(let code, let detail):
            "Backend returned HTTP \(code). \(detail)"
        case .decoding(let detail):
            "Could not read the backend's reply. \(detail)"
        case .network(let detail):
            "Network problem: \(detail)"
        }
    }
}

// MARK: - Cloud Run

/// Talks to the Cloud Run service, which holds the Gemini key server-side.
struct RemoteBrain: Brain {
    let baseURL: String
    let token: String
    let session: URLSession

    init(
        baseURL: String = Settings.backendURL,
        token: String = Keychain.apiToken ?? "",
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    func sync(
        attempts: [OutgoingAttempt],
        wantSentences: Int,
        since: Date?
    ) async throws -> SyncResult {
        guard !baseURL.isEmpty, !token.isEmpty else { throw BrainError.notConfigured }
        guard let url = URL(string: baseURL.trimmingCharacters(in: .whitespaces))?
            .appendingPathComponent("v1/sync")
        else { throw BrainError.badURL(baseURL) }

        struct Body: Encodable {
            let attempts: [OutgoingAttempt]
            let wantSentences: Int
            let since: Date?
        }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try encoder.encode(
            Body(attempts: attempts, wantSentences: wantSentences, since: since)
        )
        // Generation of a full batch can legitimately take minutes.
        request.timeoutInterval = 300

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw BrainError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw BrainError.network("non-HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            let detail = String(data: data, encoding: .utf8)?.prefix(300) ?? ""
            throw BrainError.http(http.statusCode, String(detail))
        }

        do {
            return try JSONDecoder().decode(SyncResult.self, from: data)
        } catch {
            let preview = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw BrainError.decoding("\(error.localizedDescription) — \(preview)")
        }
    }
}

// MARK: - Direct fallback

/// Phone straight to Gemini, bypassing the backend.
///
/// Useful before the backend is deployed, and as a fallback when it is down.
/// Costs: the Gemini key lives on the device, and there is no server-side
/// usage cap — only the client-side pacer.
struct DirectGeminiBrain: Brain {
    let client: GeminiClient

    init(client: GeminiClient = GeminiClient()) {
        self.client = client
    }

    func sync(
        attempts: [OutgoingAttempt],
        wantSentences: Int,
        since: Date?
    ) async throws -> SyncResult {
        var grades: [Grade] = []

        let gradable = attempts.filter {
            $0.typedAnswer?.isEmpty == false || $0.audioBase64 != nil
        }
        for chunk in gradable.chunked(into: 10) {
            let items = chunk.map { attempt in
                GradingItem(
                    id: UUID(uuidString: attempt.id) ?? UUID(),
                    englishText: attempt.englishText,
                    referenceFarsi: attempt.referenceFarsi,
                    learnerText: attempt.typedAnswer,
                    audioURL: nil   // audio path handled by AttemptUploader
                )
            }
            grades.append(contentsOf: try await client.grade(items))
        }

        var sentences: [SentenceDTO] = []
        if wantSentences > 0 {
            let generated = try await client.generateSentences(
                count: wantSentences,
                situations: Array(Situations.all.shuffled().prefix(4)),
                difficultyMix: [1: wantSentences / 5, 2: wantSentences * 2 / 5,
                                3: wantSentences * 2 / 5],
                focusTags: [],
                avoid: []
            )
            sentences = generated.map {
                SentenceDTO(
                    id: UUID().uuidString,
                    englishText: $0.englishText,
                    farsiText: $0.farsiText,
                    finglish: $0.finglish,
                    literalGloss: $0.literalGloss,
                    difficulty: $0.difficulty,
                    situation: $0.situation,
                    grammarTags: $0.grammarTags
                )
            }
        }

        return SyncResult(
            grades: grades,
            sentences: sentences,
            focusTags: [],
            usage: nil,
            warnings: ["Using the direct Gemini path — no server-side usage cap."]
        )
    }
}

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
