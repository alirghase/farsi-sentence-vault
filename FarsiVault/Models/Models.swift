import Foundation
import SwiftData

/// A translation pair. Direction-agnostic — the same pair is practised both ways.
@Model
final class Sentence {
    @Attribute(.unique) var id: UUID
    var englishText: String
    var farsiText: String
    var finglish: String
    var literalGloss: String
    var difficulty: Int
    var situation: String
    var grammarTags: [String]
    var sourceRaw: String
    var batchDate: Date?
    var createdAt: Date

    var source: SentenceSource {
        get { SentenceSource(rawValue: sourceRaw) ?? .seed }
        set { sourceRaw = newValue.rawValue }
    }

    init(
        id: UUID = UUID(),
        englishText: String,
        farsiText: String,
        finglish: String,
        literalGloss: String,
        difficulty: Int,
        situation: String,
        grammarTags: [String],
        source: SentenceSource,
        batchDate: Date? = nil,
        createdAt: Date = .now
    ) {
        self.id = id
        self.englishText = englishText
        self.farsiText = farsiText
        self.finglish = finglish
        self.literalGloss = literalGloss
        self.difficulty = difficulty
        self.situation = situation
        self.grammarTags = grammarTags
        self.sourceRaw = source.rawValue
        self.batchDate = batchDate
        self.createdAt = createdAt
    }

    /// What the learner is shown, for a given direction.
    func prompt(for direction: Direction) -> String {
        direction == .enToFa ? englishText : farsiText
    }

    /// The reference answer, for a given direction.
    func answer(for direction: Direction) -> String {
        direction == .enToFa ? farsiText : englishText
    }
}

/// SM-2 scheduling state for one (sentence, direction) pair.
@Model
final class ReviewState {
    var sentenceID: UUID
    var directionRaw: String
    var easeFactor: Double
    var intervalDays: Int
    var repetitions: Int
    var dueDate: Date
    var lapses: Int
    var lastReviewed: Date?

    var direction: Direction {
        get { Direction(rawValue: directionRaw) ?? .enToFa }
        set { directionRaw = newValue.rawValue }
    }

    init(sentenceID: UUID, direction: Direction, dueDate: Date = .now) {
        self.sentenceID = sentenceID
        self.directionRaw = direction.rawValue
        self.easeFactor = SM2.defaultEase
        self.intervalDays = 0
        self.repetitions = 0
        self.dueDate = dueDate
        self.lapses = 0
        self.lastReviewed = nil
    }
}

/// One recorded answer. Attempts in `.typed` or `.recorded` mode queue up
/// ungraded until the next sync.
@Model
final class Attempt {
    @Attribute(.unique) var id: UUID
    var sentenceID: UUID
    var directionRaw: String
    var modeRaw: String
    var selfRatingRaw: String?
    var typedAnswer: String?
    var audioFilename: String?

    // Filled in by Gemini at sync time.
    var transcript: String?
    var aiScore: Int?
    var aiVerdictRaw: String?
    var aiFeedback: String?
    var correctedFarsi: String?
    var aiErrorTags: [String]
    var gradedAt: Date?

    /// When this attempt was last reported to the backend. Self-rated attempts
    /// never need grading but still must be reported, because they carry the
    /// tag signal for the default practice mode.
    var syncedAt: Date?

    var createdAt: Date

    var direction: Direction {
        get { Direction(rawValue: directionRaw) ?? .enToFa }
        set { directionRaw = newValue.rawValue }
    }
    var mode: PracticeMode {
        get { PracticeMode(rawValue: modeRaw) ?? .speakSelfRate }
        set { modeRaw = newValue.rawValue }
    }
    var selfRating: SelfRating? {
        get { selfRatingRaw.flatMap(SelfRating.init(rawValue:)) }
        set { selfRatingRaw = newValue?.rawValue }
    }
    var aiVerdict: GradeVerdict? {
        get { aiVerdictRaw.flatMap(GradeVerdict.init(rawValue:)) }
        set { aiVerdictRaw = newValue?.rawValue }
    }

    /// Has content for the grader: typed text or a recording, not yet graded.
    var needsGrading: Bool {
        guard gradedAt == nil else { return false }
        if typedAnswer?.isEmpty == false { return true }
        if audioFilename != nil { return true }
        return false
    }

    /// Should be included in the next sync — either to be graded, or to report
    /// a self-rating that feeds the error-tag statistics.
    var needsSync: Bool {
        syncedAt == nil && (needsGrading || selfRatingRaw != nil)
    }

    /// Audio that has served its purpose and can be deleted.
    var audioIsDisposable: Bool {
        gradedAt != nil && audioFilename != nil
    }

    init(
        id: UUID = UUID(),
        sentenceID: UUID,
        direction: Direction,
        mode: PracticeMode,
        selfRating: SelfRating? = nil,
        typedAnswer: String? = nil,
        audioFilename: String? = nil,
        createdAt: Date = .now
    ) {
        self.id = id
        self.sentenceID = sentenceID
        self.directionRaw = direction.rawValue
        self.modeRaw = mode.rawValue
        self.selfRatingRaw = selfRating?.rawValue
        self.typedAnswer = typedAnswer
        self.audioFilename = audioFilename
        self.aiErrorTags = []
        self.syncedAt = nil
        self.createdAt = createdAt
    }
}

/// Running tally per error tag. Drives both the Weak Spots screen and the
/// focus_tags passed into the next generation batch.
@Model
final class ErrorTagStat {
    @Attribute(.unique) var tag: String
    var failCount: Int
    var totalCount: Int
    var lastSeen: Date

    var failureRate: Double {
        totalCount == 0 ? 0 : Double(failCount) / Double(totalCount)
    }

    init(tag: String, failCount: Int = 0, totalCount: Int = 0, lastSeen: Date = .now) {
        self.tag = tag
        self.failCount = failCount
        self.totalCount = totalCount
        self.lastSeen = lastSeen
    }
}
