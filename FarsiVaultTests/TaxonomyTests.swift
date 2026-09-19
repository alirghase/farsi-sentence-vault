import XCTest
@testable import FarsiVault

/// The tag vocabulary is duplicated in Python (core/taxonomy.py) because the
/// seed generator and the live service both need it. These tests guard the
/// Swift half; tools/check_mirror.py guards that the two halves match.
final class TaxonomyTests: XCTestCase {

    func testVocabularyIsClosedAndStable() {
        XCTAssertEqual(ErrorTag.allCases.count, 16)
        // Raw values are the wire format — changing one silently orphans every
        // ErrorTagStat already recorded under the old spelling.
        XCTAssertEqual(ErrorTag.raMarker.rawValue, "ra-marker")
        XCTAssertEqual(ErrorTag.compoundVerb.rawValue, "compound-verb")
        XCTAssertEqual(ErrorTag.pronounClitic.rawValue, "pronoun-clitic")
    }

    func testEveryTagHasDistinctTitleAndDetail() {
        let titles = Set(ErrorTag.allCases.map(\.title))
        let details = Set(ErrorTag.allCases.map(\.detail))
        XCTAssertEqual(titles.count, ErrorTag.allCases.count)
        XCTAssertEqual(details.count, ErrorTag.allCases.count)
    }

    func testUnknownTagsDecodeToNil() {
        XCTAssertNil(ErrorTag(rawValue: "ezāfe"))
        XCTAssertNil(ErrorTag(rawValue: "missing ezafe"))
        XCTAssertNotNil(ErrorTag(rawValue: "ezafe"))
    }

    func testFailureRateIsSafeWhenUnseen() {
        let stat = ErrorTagStat(tag: "ezafe")
        XCTAssertEqual(stat.failureRate, 0, "must not divide by zero")
    }

    func testFailureRateReflectsAppearances() {
        let stat = ErrorTagStat(tag: "ezafe", failCount: 1, totalCount: 4)
        XCTAssertEqual(stat.failureRate, 0.25, accuracy: 0.0001)
    }

    func testPromptsCarryTheClosedVocabulary() {
        let system = Prompts.gradingSystem
        for tag in ErrorTag.allCases {
            XCTAssertTrue(
                system.contains(tag.rawValue),
                "grading prompt must list \(tag.rawValue) or the model cannot use it"
            )
        }
    }

    func testGenerationPromptDemandsSpokenRegister() {
        // Register is the difference between useful practice and drilling
        // sentences no one says out loud.
        let system = Prompts.generationSystem
        XCTAssertTrue(system.contains("SPOKEN"))
        XCTAssertTrue(system.contains("می‌رم"))
        XCTAssertTrue(system.contains("خونه"))
    }
}
