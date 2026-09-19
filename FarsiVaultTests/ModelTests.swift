import SwiftData
import XCTest
@testable import FarsiVault

final class ModelTests: XCTestCase {

    private func makeContext() throws -> ModelContext {
        let container = try ModelContainer(
            for: Sentence.self, ReviewState.self, Attempt.self, ErrorTagStat.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        return ModelContext(container)
    }

    private func sample(difficulty: Int = 2, tags: [String] = ["ezafe"]) -> Sentence {
        Sentence(
            englishText: "I should have called you yesterday",
            farsiText: "باید دیروز بهت زنگ می‌زدم",
            finglish: "bâyad diruz behet zang mizadam",
            literalGloss: "must yesterday to-you bell I-was-hitting",
            difficulty: difficulty,
            situation: "phone call with family",
            grammarTags: tags,
            source: .seed
        )
    }

    func testPromptAndAnswerFlipWithDirection() {
        let sentence = sample()
        XCTAssertEqual(sentence.prompt(for: .enToFa), sentence.englishText)
        XCTAssertEqual(sentence.answer(for: .enToFa), sentence.farsiText)
        XCTAssertEqual(sentence.prompt(for: .faToEn), sentence.farsiText)
        XCTAssertEqual(sentence.answer(for: .faToEn), sentence.englishText)
    }

    func testSelfRatedAttemptStillNeedsSync() throws {
        // Speak-aloud is the default mode and produces no gradable content, but
        // it carries the tag signal — excluding it would leave adaptation blind
        // to most practice.
        let attempt = Attempt(
            sentenceID: UUID(), direction: .enToFa,
            mode: .speakSelfRate, selfRating: .again
        )
        XCTAssertFalse(attempt.needsGrading)
        XCTAssertTrue(attempt.needsSync)
    }

    func testSyncedAttemptIsNotResent() {
        let attempt = Attempt(
            sentenceID: UUID(), direction: .enToFa,
            mode: .speakSelfRate, selfRating: .good
        )
        attempt.syncedAt = .now
        XCTAssertFalse(attempt.needsSync)
    }

    func testTypedAttemptNeedsGrading() {
        let attempt = Attempt(
            sentenceID: UUID(), direction: .enToFa, mode: .typed,
            selfRating: .good, typedAnswer: "میرم خونه"
        )
        XCTAssertTrue(attempt.needsGrading)
        XCTAssertTrue(attempt.needsSync)
    }

    func testAudioIsDisposableOnlyAfterGrading() {
        let attempt = Attempt(
            sentenceID: UUID(), direction: .enToFa,
            mode: .recorded, audioFilename: "clip.m4a"
        )
        XCTAssertFalse(attempt.audioIsDisposable)
        attempt.gradedAt = .now
        XCTAssertTrue(attempt.audioIsDisposable)
    }

    func testSessionBuilderSchedulesBothDirections() throws {
        let context = try makeContext()
        for _ in 0..<10 { context.insert(sample()) }
        try context.save()

        let cards = try SessionBuilder.build(context: context, limit: 20, productionRatio: 0.5)

        XCTAssertEqual(cards.count, 20, "10 sentences x 2 directions")
        XCTAssertEqual(Set(cards.map(\.direction)), Set(Direction.allCases))
    }

    func testSessionBuilderHonoursProductionRatio() throws {
        let context = try makeContext()
        for _ in 0..<50 { context.insert(sample()) }
        try context.save()

        let cards = try SessionBuilder.build(context: context, limit: 20, productionRatio: 0.7)
        let production = cards.filter { $0.direction == .enToFa }.count

        XCTAssertEqual(cards.count, 20)
        XCTAssertEqual(production, 14, "70% of 20 should be EN→FA")
    }

    func testSessionBuilderBackfillsWhenOneDirectionRunsDry() throws {
        let context = try makeContext()
        // Only two sentences: four cards total, so a 20-card request cannot be
        // satisfied at the requested ratio and must backfill rather than error.
        for _ in 0..<2 { context.insert(sample()) }
        try context.save()

        let cards = try SessionBuilder.build(context: context, limit: 20, productionRatio: 0.7)
        XCTAssertEqual(cards.count, 4)
        XCTAssertEqual(Set(cards.map(\.id)).count, 4, "no duplicate cards")
    }

    func testEmptyStoreProducesEmptySession() throws {
        let context = try makeContext()
        XCTAssertTrue(try SessionBuilder.build(context: context, limit: 20).isEmpty)
    }

    func testCountsReflectUnscheduledCards() throws {
        let context = try makeContext()
        for _ in 0..<5 { context.insert(sample()) }
        try context.save()

        let counts = try SessionBuilder.counts(context: context)
        XCTAssertEqual(counts.due, 0)
        XCTAssertEqual(counts.new, 10, "5 sentences x 2 directions, none scheduled")
    }
}
