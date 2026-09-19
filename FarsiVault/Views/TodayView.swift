import SwiftData
import SwiftUI

struct TodayView: View {
    @Environment(\.modelContext) private var context
    @Query private var sentences: [Sentence]
    @Query private var attempts: [Attempt]

    @StateObject private var sync = SyncService()
    @State private var counts = SessionBuilder.Counts(due: 0, new: 0)
    @State private var session: [PracticeCard] = []
    @State private var showingPractice = false

    private var pendingSync: Int { attempts.filter(\.needsSync).count }

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                Spacer()

                if sentences.isEmpty {
                    emptyState
                } else {
                    countsView
                    startButton
                }

                Spacer()
                syncBar
            }
            .padding(.horizontal, 24)
            .navigationTitle("Today")
            .onAppear(perform: refresh)
            .fullScreenCover(isPresented: $showingPractice, onDismiss: refresh) {
                PracticeView(cards: session)
            }
        }
    }

    private var countsView: some View {
        HStack(spacing: 28) {
            stat(value: counts.due, label: "due", tint: .orange)
            Divider().frame(height: 44)
            stat(value: min(counts.new, Settings.dailyBatchSize), label: "new", tint: .blue)
        }
    }

    private func stat(value: Int, label: String, tint: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.system(size: 44, weight: .semibold, design: .rounded))
                .foregroundStyle(value == 0 ? Color.secondary : tint)
                .contentTransition(.numericText())
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var startButton: some View {
        Button {
            startSession()
        } label: {
            Text(counts.total == 0 ? "Nothing due" : "Start")
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity)
                .frame(height: 56)
        }
        .buttonStyle(.borderedProminent)
        .disabled(counts.total == 0)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("No sentences yet")
                .font(.headline)
            Text("Sync to fetch your first batch, or add the bundled seed bank to the app target.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: Sync

    private var syncBar: some View {
        VStack(spacing: 10) {
            switch sync.phase {
            case .working(let message):
                HStack(spacing: 8) {
                    ProgressView()
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                }
            case .failed(let message):
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            case .done(let summary, let warnings):
                VStack(spacing: 4) {
                    Text(summary).font(.footnote).foregroundStyle(.secondary)
                    ForEach(warnings, id: \.self) { warning in
                        Text(warning)
                            .font(.caption2)
                            .foregroundStyle(.orange)
                            .multilineTextAlignment(.center)
                    }
                }
            case .idle:
                if pendingSync > 0 {
                    Text("\(pendingSync) attempt\(pendingSync == 1 ? "" : "s") waiting to be graded")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Button {
                Task {
                    await sync.sync(context: context)
                    refresh()
                }
            } label: {
                Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .buttonStyle(.bordered)
            .disabled(sync.isWorking)

            if let last = Settings.lastSyncAt {
                Text("Last synced \(last.formatted(.relative(presentation: .named)))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.bottom, 8)
        .animation(.default, value: pendingSync)
    }

    // MARK: Actions

    private func refresh() {
        counts = (try? SessionBuilder.counts(context: context)) ?? counts
    }

    private func startSession() {
        let limit = min(Settings.dailyBatchSize, max(counts.total, 1))
        session = (try? SessionBuilder.build(context: context, limit: limit)) ?? []
        guard !session.isEmpty else { return }
        showingPractice = true
    }
}
