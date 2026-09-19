import Foundation

/// Prompt templates. MIRRORS tools/prompts.py — iterate there first (seconds),
/// port here once the output is consistently good (minutes per rebuild).
enum Prompts {

    /// The single most important part of generation. Without it the model
    /// writes literary Persian — grammatical, and not how anyone speaks.
    /// Drilling that register is worse than useless: it trains you to sound
    /// like a newsreader in a coffee shop.
    static let registerRules = """
    Write SPOKEN, everyday Tehrani Persian — the register used between friends and
    family in conversation. NOT written, literary, formal, or news Persian.

    Apply these spoken forms consistently:
      - Present verbs contract: می‌روم -> می‌رم, می‌خواهم -> می‌خوام, می‌گویم -> می‌گم
      - "است" becomes the attached -ه: "خوب است" -> "خوبه", "کجاست" not "کجا است"
      - را -> رو after a vowel, or drops in fast speech: "کتاب رو بده"
      - Prepositional pronouns contract: "به او" -> "بهش", "از او" -> "ازش"
      - ân -> un raising: نان -> نون, تهران -> تهرون, خانه -> خونه
      - برای -> واسه, هیچ چیز -> هیچی, چه کار -> چیکار
      - Use informal 2nd person (تو / -ی) unless the situation calls for formality,
        in which case use شما and say so via the "formality" grammar tag.

    Never mix registers inside one sentence. Never use Arabic-heavy literary
    vocabulary where a common Persian word exists.
    """

    static let finglishRules = """
    The "finglish" field is a Latin transliteration using this exact scheme:
      - â = the long open 'a' (آب -> âb)
      - a e o i u = short/other vowels
      - kh gh ch sh zh for خ ق/غ چ ش ژ
      - ' for the glottal stop (معنی -> ma'ni)
      - Write it as it is SPOKEN, matching the colloquial Persian exactly:
        "می‌رم خونه" -> "miram khune", never "miravam khâne"
      - Separate clitics with no hyphen: "behesh", "khubam"
    """

    static var generationSystem: String {
        """
        You write translation-practice sentences for an English speaker learning to SPEAK
        conversational Persian (Farsi). The learner knows common words and verbs but
        freezes when producing a sentence under time pressure. Your sentences are what
        they will say out loud, hundreds of times.

        \(registerRules)

        \(finglishRules)

        The "literalGloss" field is a word-by-word English gloss of the Persian, in
        Persian word order, so the learner can see the structure. Example:
          Persian: باید دیروز بهت زنگ می‌زدم
          Gloss:   "must yesterday to-you bell I-was-hitting"

        Difficulty levels:
        \(Difficulty.reference())

        Tag each sentence with the grammar features a learner must get right to produce
        it. Use ONLY these tags:
        \(ErrorTag.reference())

        Rules:
          - The English must be natural English, not a translation of the Persian.
          - Every sentence must be something a real person would actually say.
          - No proper nouns that need cultural knowledge to understand.
          - Vary sentence openings; do not start many sentences the same way.
        """
    }

    static func generationUser(
        count: Int,
        situations: [String],
        difficultyMix: [Int: Int],
        focusTags: [ErrorTag],
        avoid: [String]
    ) -> String {
        var lines = [
            "Generate exactly \(count) sentences.",
            "Difficulty mix: " + difficultyMix.sorted { $0.key < $1.key }
                .map { "\($0.value) at level \($0.key)" }
                .joined(separator: ", ") + ".",
            "Spread them across these situations: \(situations.joined(separator: ", ")).",
        ]
        if !focusTags.isEmpty {
            lines.append(
                "PRIORITY: the learner is currently failing these grammar features — "
                + "at least half the sentences must require them: "
                + focusTags.map(\.rawValue).joined(separator: ", ") + "."
            )
        }
        if !avoid.isEmpty {
            let sample = avoid.prefix(40).map { "  - \($0)" }.joined(separator: "\n")
            lines.append(
                "Do NOT repeat or trivially reword any of these already-seen sentences:\n"
                + sample
            )
        }
        return lines.joined(separator: "\n\n")
    }

    static var gradingSystem: String {
        """
        You grade a Persian learner's translation attempts. You are strict about meaning
        and grammar, and generous about register variation that a native would accept.

        For each attempt you receive the English prompt, the reference Persian, and the
        learner's attempt (as text, or as an audio recording you must transcribe first).

        \(registerRules)

        Grading:
          - score 0-100. 100 = a native would say this and it means the same thing.
          - The reference Persian is ONE correct answer, not the only one. If the
            learner's version is different but equally natural and correct, score it
            high and say so. Do not penalise valid alternatives.
          - Penalise meaning changes hardest, then grammar, then register, then
            naturalness.
          - verdict: "correct" (90-100), "minor" (70-89), "major" (40-69), "wrong" (0-39).

        feedback: ONE short sentence, addressed to the learner, naming the single most
        useful thing to fix. No preamble, no praise padding. If the attempt was correct,
        say what made it good in a few words.

        correctedFarsi: the learner's own sentence minimally repaired. If it was already
        correct, echo it back unchanged.

        errorTags: ONLY from this list, and only tags the learner actually got wrong.
        An empty list is correct for a perfect attempt.
        \(ErrorTag.reference())

        For audio attempts, "transcript" is what you actually heard in Persian script —
        transcribe honestly, including errors and hesitation. Do not silently correct the
        learner's speech into the reference sentence. If the audio is unintelligible or
        silent, set transcript to "" and verdict to "wrong" with the tag "vocab-gap".
        """
    }

    static func gradingUser(_ items: [GradingItem]) -> String {
        let blocks = items.map { item -> String in
            let learnerLine = if let text = item.learnerText, !text.isEmpty {
                "  learner attempt (text): \(text)"
            } else {
                "  learner attempt: see the attached audio recording, in order"
            }
            return """
            attemptId: \(item.id.uuidString)
              english: \(item.englishText)
              reference persian: \(item.referenceFarsi)
            \(learnerLine)
            """
        }
        return "Grade these \(items.count) attempts. Return one entry per attemptId, "
            + "in the same order.\n\n"
            + blocks.joined(separator: "\n\n")
    }
}
