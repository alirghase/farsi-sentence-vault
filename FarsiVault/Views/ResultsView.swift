import SwiftData
import SwiftUI

/// Graded attempts, newest first. This is where recorded and typed answers come
/// back with a score, a correction, and the single most useful fix.
struct ResultsView: View {
    @Query(sort: \Attempt.createdAt, order: .reverse) private var attempts: [Attempt]
    @Query private var sentences: [Sentence]

    private var graded: [Attempt] { attempts.filter { $0.gradedAt != nil } }

    private var byID: [UUID: Sentence] {
        Dictionary(sentences.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }

    var body: some View {
        NavigationStack {
            Group {
                if graded.isEmpty {
                    ContentUnavailableView(
                        "Nothing graded yet",
                        systemImage: "checkmark.circle",
                        description: Text("Type or record an answer, then sync to have it graded.")
                    )
                } else {
                    List(graded) { attempt in
                        row(attempt)
                    }
                }
            }
            .navigationTitle("Results")
        }
    }

    private func row(_ attempt: Attempt) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if let score = attempt.aiScore {
                    Text("\(score)")
                        .font(.title3.weight(.bold).monospacedDigit())
                        .foregroundStyle(colour(for: attempt.aiVerdict))
                }
                Text(attempt.aiVerdict?.rawValue.capitalized ?? "")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(colour(for: attempt.aiVerdict))
                Spacer()
                Label(
                    attempt.mode == .recorded ? "spoken" : "typed",
                    systemImage: attempt.mode == .recorded ? "mic" : "keyboard"
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            if let sentence = byID[attempt.sentenceID] {
                Text(sentence.englishText)
                    .font(.subheadline)
            }

            if let heard = attempt.transcript ?? attempt.typedAnswer {
                labelled("You said", heard, colour: .secondary)
            }
            if let corrected = attempt.correctedFarsi, corrected != (attempt.transcript ?? attempt.typedAnswer) {
                labelled("Should be", corrected, colour: .primary)
            }
            if let feedback = attempt.aiFeedback, !feedback.isEmpty {
                Text(feedback)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !attempt.aiErrorTags.isEmpty {
                HStack(spacing: 6) {
                    ForEach(attempt.aiErrorTags, id: \.self) { raw in
                        Text(ErrorTag(rawValue: raw)?.title ?? raw)
                            .font(.caption2)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(.red.opacity(0.15), in: Capsule())
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func labelled(_ label: String, _ text: String, colour: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.tertiary)
            Text(text)
                .font(.callout)
                .foregroundStyle(colour)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private func colour(for verdict: GradeVerdict?) -> Color {
        switch verdict {
        case .correct: .green
        case .minor: .blue
        case .major: .orange
        case .wrong: .red
        case nil: .secondary
        }
    }
}
