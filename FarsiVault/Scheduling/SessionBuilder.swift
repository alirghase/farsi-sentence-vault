import Foundation
import SwiftData

/// One card in a practice session: a sentence, a direction, and its schedule.
struct PracticeCard: Identifiable, Hashable {
    let sentence: Sentence
    let direction: Direction
    let review: ReviewState

    var id: String { "\(sentence.id.uuidString)-\(direction.rawValue)" }

    var prompt: String { sentence.prompt(for: direction) }
    var answer: String { sentence.answer(for: direction) }

    static func == (lhs: PracticeCard, rhs: PracticeCard) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// Assembles the day's queue from due reviews plus unseen sentences.
enum SessionBuilder {

    struct Counts {
        var due: Int
        var new: Int
        var total: Int { due + new }
    }

    /// Build a session.
    ///
    /// Due cards come first in the pool, then new ones, and the whole thing is
    /// shuffled — a session that front-loads every review and back-loads every
    /// new card feels like two different activities.
    static func build(
        context: ModelContext,
        limit: Int,
        productionRatio: Double = Settings.productionRatio,
        now: Date = .now
    ) throws -> [PracticeCard] {
        let sentences = try context.fetch(FetchDescriptor<Sentence>())
        guard !sentences.isEmpty else { return [] }
        let byID = Dictionary(uniqueKeysWithValues: sentences.map { ($0.id, $0) })

        let states = try context.fetch(FetchDescriptor<ReviewState>())
        var stateIndex: [String: ReviewState] = [:]
        for state in states {
            stateIndex["\(state.sentenceID.uuidString)-\(state.directionRaw)"] = state
        }

        var due: [PracticeCard] = []
        var fresh: [PracticeCard] = []

        for sentence in sentences {
            for direction in Direction.allCases {
                let key = "\(sentence.id.uuidString)-\(direction.rawValue)"
                if let state = stateIndex[key] {
                    if state.dueDate <= now {
                        due.append(PracticeCard(sentence: sentence, direction: direction, review: state))
                    }
                } else {
                    // Materialise lazily: creating two ReviewState rows for every
                    // sentence up front would mean ~800 rows for a 400-sentence
                    // seed bank the learner has not touched.
                    let state = ReviewState(sentenceID: sentence.id, direction: direction)
                    fresh.append(PracticeCard(sentence: sentence, direction: direction, review: state))
                }
            }
        }
        _ = byID

        due.sort { $0.review.dueDate < $1.review.dueDate }
        fresh.shuffle()

        let selected = select(
            due: due, fresh: fresh, limit: limit, productionRatio: productionRatio
        )
        // Persist the states for new cards that actually made it into the session.
        for card in selected where card.review.lastReviewed == nil && card.review.repetitions == 0 {
            if stateIndex[card.id] == nil {
                context.insert(card.review)
            }
        }
        return selected.shuffled()
    }

    /// Honour the EN→FA ratio while filling the session, preferring due cards.
    private static func select(
        due: [PracticeCard],
        fresh: [PracticeCard],
        limit: Int,
        productionRatio: Double
    ) -> [PracticeCard] {
        let ratio = min(max(productionRatio, 0), 1)
        let productionTarget = Int((Double(limit) * ratio).rounded())
        let comprehensionTarget = limit - productionTarget

        var chosen: [PracticeCard] = []
        var remaining = [Direction.enToFa: productionTarget, .faToEn: comprehensionTarget]

        for pool in [due, fresh] {
            for card in pool where chosen.count < limit {
                guard (remaining[card.direction] ?? 0) > 0 else { continue }
                chosen.append(card)
                remaining[card.direction, default: 0] -= 1
            }
        }
        // If one direction ran dry, backfill from whatever is left rather than
        // returning a short session.
        if chosen.count < limit {
            let taken = Set(chosen.map(\.id))
            for pool in [due, fresh] {
                for card in pool where chosen.count < limit && !taken.contains(card.id) {
                    chosen.append(card)
                }
            }
        }
        return chosen
    }

    /// Counts for the Today screen, without building the full session.
    static func counts(context: ModelContext, now: Date = .now) throws -> Counts {
        let sentenceCount = try context.fetchCount(FetchDescriptor<Sentence>())
        let states = try context.fetch(FetchDescriptor<ReviewState>())
        let due = states.filter { $0.dueDate <= now }.count
        // Two directions per sentence, minus the ones already scheduled.
        let scheduled = states.count
        let new = max(0, sentenceCount * Direction.allCases.count - scheduled)
        return Counts(due: due, new: new)
    }
}
