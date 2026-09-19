import SwiftData
import SwiftUI

/// Where "gets more sophisticated" becomes visible instead of a black box.
///
/// Ranked by failure rate, not raw failure count — a tag you meet constantly
/// and fail sometimes is a smaller problem than one you fail nearly every time.
struct WeakSpotsView: View {
    @Query(sort: \ErrorTagStat.tag) private var stats: [ErrorTagStat]

    /// Tags seen too few times are noise: two appearances and two failures is a
    /// 100% rate on no evidence, and would otherwise top the list forever.
    private let minimumEvidence = 3

    private var ranked: [ErrorTagStat] {
        stats
            .filter { $0.totalCount >= minimumEvidence && $0.failCount > 0 }
            .sorted { $0.failureRate > $1.failureRate }
    }

    private var emerging: [ErrorTagStat] {
        stats.filter { $0.totalCount > 0 && $0.totalCount < minimumEvidence }
    }

    var body: some View {
        NavigationStack {
            Group {
                if stats.allSatisfy({ $0.totalCount == 0 }) {
                    ContentUnavailableView(
                        "No data yet",
                        systemImage: "chart.bar",
                        description: Text("Practise and sync, and your weakest grammar features will show up here.")
                    )
                } else {
                    List {
                        if !ranked.isEmpty {
                            Section {
                                ForEach(ranked) { stat in row(stat) }
                            } header: {
                                Text("Weakest first")
                            } footer: {
                                Text("The top few feed the next generated batch, so these get drilled automatically.")
                            }
                        }

                        if !emerging.isEmpty {
                            Section("Not enough data yet") {
                                ForEach(emerging) { stat in
                                    HStack {
                                        Text(ErrorTag(rawValue: stat.tag)?.title ?? stat.tag)
                                        Spacer()
                                        Text("\(stat.totalCount) seen")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Weak spots")
        }
    }

    private func row(_ stat: ErrorTagStat) -> some View {
        let tag = ErrorTag(rawValue: stat.tag)
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(tag?.title ?? stat.tag)
                    .font(.body.weight(.medium))
                Spacer()
                Text("\(Int(stat.failureRate * 100))%")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                    .foregroundStyle(colour(for: stat.failureRate))
            }

            ProgressView(value: stat.failureRate)
                .tint(colour(for: stat.failureRate))

            HStack(spacing: 4) {
                Text("\(stat.failCount) wrong of \(stat.totalCount)")
                if let detail = tag?.detail {
                    Text("·")
                    Text(detail).lineLimit(1)
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func colour(for rate: Double) -> Color {
        switch rate {
        case ..<0.25: .green
        case ..<0.5: .yellow
        case ..<0.75: .orange
        default: .red
        }
    }
}
