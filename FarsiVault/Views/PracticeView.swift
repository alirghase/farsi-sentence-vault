import SwiftData
import SwiftUI

/// The core loop: prompt → produce → reveal → rate.
///
/// Designed for one hand on a commute. The default path costs zero taps until
/// Reveal: read the prompt, say the answer out loud, tap once to check, tap
/// once to rate. Typing and recording are opt-in per card, not modes you have
/// to switch into.
struct PracticeView: View {
    let cards: [PracticeCard]

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @StateObject private var recorder = Recorder.shared
    @StateObject private var speaker = Speaker.shared

    @State private var queue: [PracticeCard] = []
    @State private var index = 0
    @State private var revealed = false
    @State private var typed = ""
    @State private var showingTypeField = false
    @State private var clipFilename: String?
    @State private var completed = 0
    @FocusState private var typingFocused: Bool

    private var card: PracticeCard? {
        queue.indices.contains(index) ? queue[index] : nil
    }

    var body: some View {
        NavigationStack {
            Group {
                if let card {
                    content(for: card)
                } else {
                    finished
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { finish() }
                }
                ToolbarItem(placement: .principal) {
                    Text("\(completed) / \(cards.count)")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .onAppear { if queue.isEmpty { queue = cards } }
    }

    // MARK: Card

    private func content(for card: PracticeCard) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    directionBadge(card)
                    promptText(card)

                    if showingTypeField {
                        typeField(card)
                    }

                    if revealed {
                        answerBlock(card)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, 16)
            }

            controls(for: card)
        }
        .animation(.snappy(duration: 0.22), value: revealed)
        .animation(.snappy(duration: 0.22), value: showingTypeField)
    }

    private func directionBadge(_ card: PracticeCard) -> some View {
        HStack(spacing: 8) {
            Text(card.direction.label)
            Text("·")
            Text("L\(card.sentence.difficulty)")
            if card.review.lapses > 0 {
                Text("·")
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
    }

    private func promptText(_ card: PracticeCard) -> some View {
        Text(card.prompt)
            .font(.system(size: 30, weight: .medium, design: .serif))
            .multilineTextAlignment(card.direction == .faToEn ? .trailing : .leading)
            .frame(maxWidth: .infinity, alignment: card.direction == .faToEn ? .trailing : .leading)
            .textSelection(.enabled)
    }

    private func typeField(_ card: PracticeCard) -> some View {
        TextField(
            card.direction == .enToFa ? "بنویس…" : "Type the English…",
            text: $typed,
            axis: .vertical
        )
        .focused($typingFocused)
        .font(.title3)
        .multilineTextAlignment(card.direction == .enToFa ? .trailing : .leading)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .padding(12)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
    }

    private func answerBlock(_ card: PracticeCard) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()

            HStack(alignment: .top, spacing: 12) {
                Text(card.answer)
                    .font(.system(size: 26, weight: .medium))
                    .multilineTextAlignment(card.direction == .enToFa ? .trailing : .leading)
                    .frame(maxWidth: .infinity, alignment: card.direction == .enToFa ? .trailing : .leading)
                    .textSelection(.enabled)

                if Speaker.isAvailable {
                    Button {
                        speaker.speak(card.sentence.farsiText)
                    } label: {
                        Image(systemName: speaker.isSpeaking ? "speaker.wave.2.fill" : "play.circle")
                            .font(.title2)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tint)
                }
            }

            Text(card.sentence.finglish)
                .font(.callout)
                .foregroundStyle(.secondary)

            Text(card.sentence.literalGloss)
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .italic()

            if !card.sentence.grammarTags.isEmpty {
                tagRow(card.sentence.grammarTags)
            }
        }
    }

    private func tagRow(_ tags: [String]) -> some View {
        HStack(spacing: 6) {
            ForEach(tags.prefix(4), id: \.self) { raw in
                Text(ErrorTag(rawValue: raw)?.title ?? raw)
                    .font(.caption2)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.quaternary.opacity(0.5), in: Capsule())
            }
        }
        .foregroundStyle(.secondary)
    }

    // MARK: Controls

    @ViewBuilder
    private func controls(for card: PracticeCard) -> some View {
        VStack(spacing: 12) {
            if revealed {
                ratingButtons(card)
            } else {
                inputAffordances(card)
                Button {
                    reveal()
                } label: {
                    Text("Reveal")
                        .font(.title3.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 12)
        .background(.bar)
    }

    private func inputAffordances(_ card: PracticeCard) -> some View {
        HStack(spacing: 16) {
            Button {
                showingTypeField.toggle()
                typingFocused = showingTypeField
            } label: {
                Label("Type", systemImage: "keyboard")
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .buttonStyle(.bordered)
            .tint(showingTypeField ? .accentColor : .secondary)

            Button {
                toggleRecording()
            } label: {
                Label(
                    recorder.isRecording ? "Stop" : (clipFilename == nil ? "Record" : "Re-record"),
                    systemImage: recorder.isRecording ? "stop.circle.fill" : "mic"
                )
                .frame(maxWidth: .infinity)
                .frame(height: 44)
            }
            .buttonStyle(.bordered)
            .tint(recorder.isRecording ? .red : (clipFilename != nil ? .green : .secondary))
        }
    }

    private func ratingButtons(_ card: PracticeCard) -> some View {
        HStack(spacing: 8) {
            ForEach(SelfRating.allCases, id: \.self) { rating in
                Button {
                    record(rating: rating, for: card)
                } label: {
                    VStack(spacing: 2) {
                        Text(rating.label).font(.subheadline.weight(.medium))
                        Text(interval(for: rating, card: card))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                }
                .buttonStyle(.bordered)
                .tint(tint(for: rating))
            }
        }
    }

    private func tint(for rating: SelfRating) -> Color {
        switch rating {
        case .again: .red
        case .hard: .orange
        case .good: .blue
        case .easy: .green
        }
    }

    /// Show what each rating costs, the way Anki does — it makes the choice
    /// meaningful instead of arbitrary.
    private func interval(for rating: SelfRating, card: PracticeCard) -> String {
        let next = SM2.next(card.review.sm2State, quality: rating.quality)
        return next.intervalDays == 1 ? "1d" : "\(next.intervalDays)d"
    }

    // MARK: Actions

    private func reveal() {
        typingFocused = false
        if recorder.isRecording { recorder.stop() }
        revealed = true
    }

    private func toggleRecording() {
        if recorder.isRecording {
            recorder.stop()
        } else {
            Task { clipFilename = await recorder.start() }
        }
    }

    private func record(rating: SelfRating, for card: PracticeCard) {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        let mode: PracticeMode =
            clipFilename != nil ? .recorded : (trimmed.isEmpty ? .speakSelfRate : .typed)

        let attempt = Attempt(
            sentenceID: card.sentence.id,
            direction: card.direction,
            mode: mode,
            selfRating: rating,
            typedAnswer: trimmed.isEmpty ? nil : trimmed,
            audioFilename: clipFilename
        )
        context.insert(attempt)

        // New cards were built in memory; make sure the state is persisted
        // before it is mutated.
        if card.review.modelContext == nil {
            context.insert(card.review)
        }
        card.review.apply(quality: rating.quality)
        try? context.save()

        completed += 1
        advance(card: card, rating: rating)
    }

    private func advance(card: PracticeCard, rating: SelfRating) {
        // "Again" means it comes back this session, not tomorrow — the whole
        // point is repetition under pressure, and a day's gap wastes the miss.
        if rating == .again {
            queue.append(card)
        }
        typed = ""
        clipFilename = nil
        showingTypeField = false
        revealed = false
        index += 1
    }

    private func finish() {
        if recorder.isRecording { recorder.stop() }
        speaker.stop()
        dismiss()
    }

    private var finished: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 52))
                .foregroundStyle(.green)
            Text("Session complete")
                .font(.title2.weight(.semibold))
            Text("\(completed) card\(completed == 1 ? "" : "s") practised")
                .foregroundStyle(.secondary)
            Button("Done") { finish() }
                .buttonStyle(.borderedProminent)
                .padding(.top, 8)
        }
        .padding()
    }
}
