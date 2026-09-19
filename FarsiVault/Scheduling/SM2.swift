import Foundation

/// SM-2 spaced repetition, as used by Anki and SuperMemo.
///
/// Deliberately a pure value-type transform with no SwiftData or UIKit
/// dependency, so it can be unit tested in isolation and reasoned about without
/// a running app.
///
/// Quality scale is 0–5. Below 3 is a lapse: repetitions reset and the card
/// comes back tomorrow. `SelfRating` and `GradeVerdict` both map onto this
/// scale, so self-rated and AI-graded attempts drive one scheduler.
enum SM2 {
    static let defaultEase = 2.5
    static let minimumEase = 1.3
    static let passingQuality = 3

    /// Cap on interval growth. Without this, a few `easy` ratings push a card
    /// years out and it effectively leaves the deck — bad for a language you
    /// are actively trying to keep warm.
    static let maximumIntervalDays = 365

    struct State: Equatable {
        var easeFactor: Double
        var intervalDays: Int
        var repetitions: Int
        var lapses: Int

        static let new = State(
            easeFactor: SM2.defaultEase,
            intervalDays: 0,
            repetitions: 0,
            lapses: 0
        )
    }

    /// Advance scheduling state by one review.
    static func next(_ state: State, quality: Int) -> State {
        let q = max(0, min(5, quality))
        var out = state

        if q < passingQuality {
            out.repetitions = 0
            out.intervalDays = 1
            out.lapses += 1
        } else {
            switch out.repetitions {
            case 0: out.intervalDays = 1
            case 1: out.intervalDays = 6
            default:
                let grown = Double(out.intervalDays) * out.easeFactor
                out.intervalDays = min(Int(grown.rounded()), maximumIntervalDays)
            }
            out.repetitions += 1
        }

        // Ease adjustment applies on every review, pass or fail.
        let delta = 0.1 - Double(5 - q) * (0.08 + Double(5 - q) * 0.02)
        out.easeFactor = max(minimumEase, out.easeFactor + delta)

        return out
    }

    /// Date a card with this state should next appear.
    static func dueDate(from state: State, reviewedAt: Date, calendar: Calendar = .current) -> Date {
        let days = max(1, state.intervalDays)
        let startOfDay = calendar.startOfDay(for: reviewedAt)
        return calendar.date(byAdding: .day, value: days, to: startOfDay) ?? reviewedAt
    }
}

extension ReviewState {
    var sm2State: SM2.State {
        SM2.State(
            easeFactor: easeFactor,
            intervalDays: intervalDays,
            repetitions: repetitions,
            lapses: lapses
        )
    }

    /// Apply one review outcome to this card.
    func apply(quality: Int, reviewedAt: Date = .now) {
        let next = SM2.next(sm2State, quality: quality)
        easeFactor = next.easeFactor
        intervalDays = next.intervalDays
        repetitions = next.repetitions
        lapses = next.lapses
        lastReviewed = reviewedAt
        dueDate = SM2.dueDate(from: next, reviewedAt: reviewedAt)
    }

    var isDue: Bool { dueDate <= .now }
}
