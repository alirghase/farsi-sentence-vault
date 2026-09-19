import Foundation

/// Which way the learner is translating.
///
/// Scheduling is per-direction: producing Farsi from English is a different
/// skill from understanding Farsi, and they decay at different rates. One
/// `Sentence` therefore backs two independent `ReviewState` rows.
enum Direction: String, Codable, CaseIterable, Sendable {
    case enToFa
    case faToEn

    var label: String {
        switch self {
        case .enToFa: "EN → FA"
        case .faToEn: "FA → EN"
        }
    }
}

/// How the learner answered. All three are available on every card; the learner
/// picks per-card rather than switching a global mode.
enum PracticeMode: String, Codable, CaseIterable, Sendable {
    case speakSelfRate   // said it out loud, graded themselves
    case typed           // typed Persian script
    case recorded        // recorded audio, graded later by Gemini
}

/// Anki-style self-assessment, mapped onto SM-2 quality scores.
enum SelfRating: String, Codable, CaseIterable, Sendable {
    case again, hard, good, easy

    /// SM-2 quality 0–5. `again` is a lapse; the rest are passes.
    var quality: Int {
        switch self {
        case .again: 2
        case .hard: 3
        case .good: 4
        case .easy: 5
        }
    }

    var label: String {
        switch self {
        case .again: "Again"
        case .hard: "Hard"
        case .good: "Good"
        case .easy: "Easy"
        }
    }
}

enum SentenceSource: String, Codable, Sendable {
    case seed        // shipped in the app bundle
    case generated   // from a daily Gemini batch
}

enum GradeVerdict: String, Codable, Sendable {
    case correct, minor, major, wrong

    /// Maps an AI grade onto the same SM-2 quality scale as a self-rating, so
    /// graded and self-rated attempts can drive one scheduler.
    var quality: Int {
        switch self {
        case .correct: 5
        case .minor: 4
        case .major: 3
        case .wrong: 2
        }
    }
}
