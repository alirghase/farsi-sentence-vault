import Foundation

/// Closed vocabulary of Persian learner errors.
///
/// MIRRORS tools/taxonomy.py — change both or adaptation breaks. The set is
/// closed on purpose: free-form tags from an LLM fragment across runs
/// ("ezafe" / "ezāfe" / "missing ezafe"), which splits ErrorTagStat counts
/// across near-duplicates and makes the "target my weak spots" loop aim at noise.
enum ErrorTag: String, CaseIterable, Codable, Sendable {
    case ezafe
    case raMarker = "ra-marker"
    case verbTense = "verb-tense"
    case subjunctive
    case verbAgreement = "verb-agreement"
    case wordOrder = "word-order"
    case preposition
    case pronounClitic = "pronoun-clitic"
    case plural
    case compoundVerb = "compound-verb"
    case vocabGap = "vocab-gap"
    case vocabWrong = "vocab-wrong"
    case formality
    case colloquial
    case spelling
    case naturalness

    var title: String {
        switch self {
        case .ezafe: "Ezâfe"
        case .raMarker: "Object marker را"
        case .verbTense: "Verb tense"
        case .subjunctive: "Subjunctive"
        case .verbAgreement: "Verb agreement"
        case .wordOrder: "Word order"
        case .preposition: "Prepositions"
        case .pronounClitic: "Attached pronouns"
        case .plural: "Plurals"
        case .compoundVerb: "Compound verbs"
        case .vocabGap: "Missing vocabulary"
        case .vocabWrong: "Wrong word choice"
        case .formality: "Formality"
        case .colloquial: "Spoken vs written"
        case .spelling: "Spelling"
        case .naturalness: "Naturalness"
        }
    }

    var detail: String {
        switch self {
        case .ezafe: "Missing, added, or misplaced ezâfe (the -e/-ye linking vowel)."
        case .raMarker: "Object marker را missing, added wrongly, or misplaced."
        case .verbTense: "Wrong tense (past vs present vs perfect vs progressive)."
        case .subjunctive: "Subjunctive missing or malformed after a modal/wish/necessity."
        case .verbAgreement: "Verb ending disagrees with the subject in person or number."
        case .wordOrder: "Constituents out of order; Persian is subject-object-verb."
        case .preposition: "Wrong or missing preposition (به/از/با/در/روی/تو)."
        case .pronounClitic: "Attached possessive/object pronouns (-am/-et/-esh) wrong."
        case .plural: "Plural formation wrong (ها/ان), or plural where Persian uses singular."
        case .compoundVerb: "Wrong light verb (کردن/شدن/زدن/دادن/گرفتن) or wrong nominal part."
        case .vocabGap: "Did not produce the needed word at all."
        case .vocabWrong: "Produced a word that exists but is the wrong choice here."
        case .formality: "Register mismatch: formal where informal is natural, or vice versa."
        case .colloquial: "Bookish form where spoken Persian differs (می‌روم vs می‌رم)."
        case .spelling: "Persian script spelling error, including ZWNJ (نیم‌فاصله)."
        case .naturalness: "Grammatical and understandable, but not how a native would say it."
        }
    }

    static var allKeys: [String] { allCases.map(\.rawValue) }

    static func reference() -> String {
        allCases.map { "- \($0.rawValue): \($0.detail)" }.joined(separator: "\n")
    }
}

enum Situations {
    static let all = [
        "phone call with family",
        "ordering food or coffee",
        "shopping and asking prices",
        "giving or following directions",
        "making plans with a friend",
        "apologising or explaining lateness",
        "disagreeing politely",
        "talking about the past (what you did)",
        "talking about future plans",
        "expressing an opinion",
        "small talk about weather or traffic",
        "at the doctor or pharmacy",
        "taxi, metro, and travel",
        "complaining about something not working",
        "asking someone to repeat or clarify",
        "compliments and thanking (taarof)",
        "talking about work or study",
        "describing how you feel",
        "hosting or visiting someone's home",
        "negotiating or asking for a favour",
    ]
}

enum Difficulty {
    static let descriptions: [Int: String] = [
        1: "One clause, present tense, high-frequency vocabulary. 3-6 words.",
        2: "One clause, past or future tense, or a simple compound verb. 5-9 words.",
        3: "Two clauses joined by که/اگر/وقتی, or a subjunctive after a modal. 8-14 words.",
        4: "Multiple clauses, conditionals, reported speech, or nuanced register. 12-20 words.",
        5: "Idiomatic or emotionally nuanced; needs taarof awareness. 12-25 words.",
    ]

    static func reference() -> String {
        descriptions.sorted { $0.key < $1.key }
            .map { "- Level \($0.key): \($0.value)" }
            .joined(separator: "\n")
    }
}
