import Foundation
import SwiftData

/// Orchestrates the one network round trip: report attempts, receive grades and
/// new sentences, fold everything back into local state.
///
/// Everything here is best-effort and resumable. A failed sync leaves attempts
/// unmarked so the next one retries them; nothing is lost by tapping Sync again.
@MainActor
final class SyncService: ObservableObject {

    enum Phase: Equatable {
        case idle
        case working(String)
        case failed(String)
        case done(summary: String, warnings: [String])
    }

    @Published private(set) var phase: Phase = .idle

    private let brain: Brain

    init(brain: Brain? = nil) {
        // Prefer the backend; fall back to talking to Gemini directly if it has
        // not been configured yet.
        self.brain = brain ?? (Settings.isConfigured ? RemoteBrain() : DirectGeminiBrain())
    }

    var isWorking: Bool {
        if case .working = phase { return true }
        return false
    }

    func sync(context: ModelContext, wantSentences: Int? = nil) async {
        phase = .working("Preparing…")
        do {
            let pending = try pendingAttempts(context: context)
            let outgoing = pending.compactMap { build(from: $0, context: context) }

            let want = wantSentences ?? Settings.dailyBatchSize
            phase = .working(
                outgoing.isEmpty
                    ? "Fetching sentences…"
                    : "Grading \(outgoing.count) attempt\(outgoing.count == 1 ? "" : "s")…"
            )

            let result = try await brain.sync(
                attempts: outgoing,
                wantSentences: want,
                since: Settings.lastSyncAt
            )

            phase = .working("Saving…")
            let gradedCount = apply(grades: result.grades, to: pending, context: context)
            let addedCount = try insert(sentences: result.sentences, context: context)

            // Mark everything we sent, graded or not — self-rated attempts have
            // now contributed their tag signal and should not be resent.
            let now = Date.now
            for attempt in pending { attempt.syncedAt = now }

            pruneAudio(for: pending)
            try context.save()
            Settings.lastSyncAt = now

            phase = .done(
                summary: summary(graded: gradedCount, added: addedCount),
                warnings: result.warnings
            )
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func dismiss() { phase = .idle }

    // MARK: - Steps

    private func pendingAttempts(context: ModelContext) throws -> [Attempt] {
        let all = try context.fetch(
            FetchDescriptor<Attempt>(sortBy: [SortDescriptor(\.createdAt)])
        )
        // Cap per sync to stay inside the backend's request limit; the rest go
        // on the next one.
        return Array(all.filter(\.needsSync).prefix(60))
    }

    private func build(from attempt: Attempt, context: ModelContext) -> OutgoingAttempt? {
        let id = attempt.sentenceID
        var descriptor = FetchDescriptor<Sentence>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        guard let sentence = try? context.fetch(descriptor).first else { return nil }

        return OutgoingAttempt(
            id: attempt.id.uuidString,
            sentenceId: sentence.id.uuidString,
            direction: attempt.directionRaw,
            mode: attempt.modeRaw,
            englishText: sentence.englishText,
            referenceFarsi: sentence.farsiText,
            grammarTags: sentence.grammarTags,
            typedAnswer: attempt.typedAnswer,
            audioBase64: attempt.audioFilename.flatMap(Recorder.base64(for:)),
            selfRating: attempt.selfRatingRaw
        )
    }

    /// Fold grades into attempts, advance the scheduler, and update local tag stats.
    private func apply(grades: [Grade], to attempts: [Attempt], context: ModelContext) -> Int {
        guard !grades.isEmpty else { return 0 }
        let byID = Dictionary(
            attempts.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { first, _ in first }
        )
        var applied = 0

        for grade in grades {
            guard let attempt = byID[grade.attemptId] else { continue }
            attempt.transcript = grade.transcript.isEmpty ? nil : grade.transcript
            attempt.aiScore = grade.score
            attempt.aiVerdict = grade.parsedVerdict
            attempt.aiFeedback = grade.feedback
            attempt.correctedFarsi = grade.correctedFarsi
            attempt.aiErrorTags = grade.errorTags
            attempt.gradedAt = .now
            applied += 1

            // An AI grade is better evidence than a self-rating, so let it
            // re-drive the scheduler for this card.
            if let state = reviewState(for: attempt, context: context) {
                state.apply(quality: grade.parsedVerdict.quality)
            }
            updateTagStats(for: attempt, grade: grade, context: context)
        }
        return applied
    }

    private func reviewState(for attempt: Attempt, context: ModelContext) -> ReviewState? {
        let sentenceID = attempt.sentenceID
        let direction = attempt.directionRaw
        var descriptor = FetchDescriptor<ReviewState>(
            predicate: #Predicate { $0.sentenceID == sentenceID && $0.directionRaw == direction }
        )
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    /// Mirror the backend's tag accounting locally, so Weak Spots works offline.
    ///
    /// `total` counts every tag the sentence exercised; `fail` only the ones the
    /// grader flagged. The rate therefore reads as "how often I get this wrong
    /// when it comes up".
    private func updateTagStats(for attempt: Attempt, grade: Grade, context: ModelContext) {
        let sentenceID = attempt.sentenceID
        var descriptor = FetchDescriptor<Sentence>(predicate: #Predicate { $0.id == sentenceID })
        descriptor.fetchLimit = 1
        let exercised = Set((try? context.fetch(descriptor).first?.grammarTags) ?? [])
        let failed = Set(grade.errorTags)

        for tag in exercised.union(failed) {
            var statDescriptor = FetchDescriptor<ErrorTagStat>(
                predicate: #Predicate { $0.tag == tag }
            )
            statDescriptor.fetchLimit = 1
            let stat: ErrorTagStat
            if let existing = try? context.fetch(statDescriptor).first {
                stat = existing
            } else {
                stat = ErrorTagStat(tag: tag)
                context.insert(stat)
            }
            stat.totalCount += 1
            if failed.contains(tag) { stat.failCount += 1 }
            stat.lastSeen = .now
        }
    }

    private func insert(sentences: [SentenceDTO], context: ModelContext) throws -> Int {
        guard !sentences.isEmpty else { return 0 }
        let existing = Set(
            try context.fetch(FetchDescriptor<Sentence>()).map(\.farsiText)
        )
        var added = 0
        for dto in sentences where !existing.contains(dto.farsiText) {
            context.insert(
                Sentence(
                    id: UUID(uuidString: dto.id) ?? UUID(),
                    englishText: dto.englishText,
                    farsiText: dto.farsiText,
                    finglish: dto.finglish,
                    literalGloss: dto.literalGloss,
                    difficulty: dto.difficulty,
                    situation: dto.situation,
                    grammarTags: dto.grammarTags,
                    source: .generated,
                    batchDate: .now
                )
            )
            added += 1
        }
        return added
    }

    /// Delete clips once their grade has come back. 100 clips a day at ~40KB is
    /// over a gigabyte a year otherwise.
    private func pruneAudio(for attempts: [Attempt]) {
        for attempt in attempts where attempt.audioIsDisposable {
            if let filename = attempt.audioFilename {
                Recorder.delete(filename)
                attempt.audioFilename = nil
            }
        }
    }

    private func summary(graded: Int, added: Int) -> String {
        switch (graded, added) {
        case (0, 0): "Nothing to sync."
        case (0, let a): "\(a) new sentence\(a == 1 ? "" : "s")."
        case (let g, 0): "\(g) attempt\(g == 1 ? "" : "s") graded."
        case (let g, let a): "\(g) graded · \(a) new sentence\(a == 1 ? "" : "s")."
        }
    }
}
