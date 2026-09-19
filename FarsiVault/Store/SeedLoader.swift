import Foundation
import SwiftData

/// Loads the bundled seed bank on first launch.
///
/// This is what makes the app useful offline the moment it opens, before any
/// backend exists. Generated once by tools/generate_seed.py and shipped in the
/// app binary.
enum SeedLoader {
    struct Bundle: Decodable {
        let version: Int
        let count: Int
        let sentences: [Seed]
    }

    struct Seed: Decodable {
        let englishText: String
        let farsiText: String
        let finglish: String
        let literalGloss: String
        let difficulty: Int
        let situation: String
        let grammarTags: [String]
    }

    /// Insert the seed bank if the store is empty. Idempotent.
    @discardableResult
    static func loadIfNeeded(into context: ModelContext) throws -> Int {
        let existing = try context.fetchCount(FetchDescriptor<Sentence>())
        guard existing == 0 else { return 0 }

        guard let url = Foundation.Bundle.main.url(
            forResource: "seed_sentences", withExtension: "json"
        ) else {
            // Not fatal: the app still works, it just has nothing to practise
            // until the first sync. The Today screen surfaces this.
            return 0
        }

        let data = try Data(contentsOf: url)
        let bundle = try JSONDecoder().decode(Bundle.self, from: data)

        for seed in bundle.sentences {
            context.insert(
                Sentence(
                    englishText: seed.englishText,
                    farsiText: seed.farsiText,
                    finglish: seed.finglish,
                    literalGloss: seed.literalGloss,
                    difficulty: seed.difficulty,
                    situation: seed.situation,
                    grammarTags: seed.grammarTags,
                    source: .seed
                )
            )
        }
        try context.save()
        return bundle.sentences.count
    }
}
