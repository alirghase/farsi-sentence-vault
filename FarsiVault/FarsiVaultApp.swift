import SwiftData
import SwiftUI

@main
struct FarsiVaultApp: App {
    let container: ModelContainer

    init() {
        do {
            container = try ModelContainer(
                for: Sentence.self, ReviewState.self, Attempt.self, ErrorTagStat.self
            )
        } catch {
            // A store that cannot open is unrecoverable; there is no useful
            // degraded mode for a local-first app.
            fatalError("Could not open the local store: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .task {
                    try? SeedLoader.loadIfNeeded(into: container.mainContext)
                }
        }
        .modelContainer(container)
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("Today", systemImage: "square.stack") }
            WeakSpotsView()
                .tabItem { Label("Weak spots", systemImage: "chart.bar") }
            ResultsView()
                .tabItem { Label("Results", systemImage: "checkmark.circle") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
