import XCTest
@testable import FarsiVault

/// The scheduler is the one piece where a subtle bug is invisible for weeks —
/// you would simply see the wrong cards, and never know why.
final class SM2Tests: XCTestCase {

    func testFirstTwoIntervalsAreFixed() {
        var state = SM2.State.new
        state = SM2.next(state, quality: SelfRating.good.quality)
        XCTAssertEqual(state.intervalDays, 1)
        state = SM2.next(state, quality: SelfRating.good.quality)
        XCTAssertEqual(state.intervalDays, 6)
    }

    func testIntervalsGrowMonotonicallyOnGood() {
        var state = SM2.State.new
        var intervals: [Int] = []
        for _ in 0..<6 {
            state = SM2.next(state, quality: SelfRating.good.quality)
            intervals.append(state.intervalDays)
        }
        XCTAssertEqual(intervals, [1, 6, 15, 38, 95, 238])
        XCTAssertTrue(zip(intervals, intervals.dropFirst()).allSatisfy(<))
    }

    func testAgainCollapsesIntervalAndRecordsLapse() {
        var state = SM2.State.new
        for _ in 0..<4 { state = SM2.next(state, quality: SelfRating.good.quality) }
        let easeBefore = state.easeFactor

        state = SM2.next(state, quality: SelfRating.again.quality)

        XCTAssertEqual(state.intervalDays, 1, "a lapse must bring the card back tomorrow")
        XCTAssertEqual(state.repetitions, 0)
        XCTAssertEqual(state.lapses, 1)
        XCTAssertLessThan(state.easeFactor, easeBefore)
    }

    func testEaseNeverFallsBelowFloor() {
        var state = SM2.State.new
        for _ in 0..<40 { state = SM2.next(state, quality: 0) }
        XCTAssertGreaterThanOrEqual(state.easeFactor, SM2.minimumEase)
    }

    func testIntervalIsCapped() {
        var state = SM2.State.new
        for _ in 0..<40 { state = SM2.next(state, quality: SelfRating.easy.quality) }
        XCTAssertLessThanOrEqual(state.intervalDays, SM2.maximumIntervalDays)
    }

    func testQualityIsClamped() {
        XCTAssertEqual(SM2.next(.new, quality: 99), SM2.next(.new, quality: 5))
        XCTAssertEqual(SM2.next(.new, quality: -7), SM2.next(.new, quality: 0))
    }

    func testHardIsAPassButShrinksEase() {
        let state = SM2.next(.new, quality: SelfRating.hard.quality)
        XCTAssertEqual(state.repetitions, 1, "hard is still a pass")
        XCTAssertEqual(state.lapses, 0)
        XCTAssertLessThan(state.easeFactor, SM2.defaultEase)
    }

    func testVerdictsMapOntoTheSameScale() {
        // An AI grade must drive the scheduler the same way a self-rating does.
        XCTAssertEqual(GradeVerdict.correct.quality, SelfRating.easy.quality)
        XCTAssertEqual(GradeVerdict.wrong.quality, SelfRating.again.quality)
        XCTAssertLessThan(GradeVerdict.wrong.quality, SM2.passingQuality)
        XCTAssertGreaterThanOrEqual(GradeVerdict.major.quality, SM2.passingQuality)
    }

    func testDueDateAdvancesByInterval() {
        let calendar = Calendar(identifier: .gregorian)
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let state = SM2.State(easeFactor: 2.5, intervalDays: 6, repetitions: 2, lapses: 0)

        let due = SM2.dueDate(from: state, reviewedAt: now, calendar: calendar)
        let days = calendar.dateComponents(
            [.day], from: calendar.startOfDay(for: now), to: due
        ).day

        XCTAssertEqual(days, 6)
    }
}
