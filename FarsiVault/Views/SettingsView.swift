import SwiftData
import SwiftUI

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @Query private var sentences: [Sentence]
    @Query private var attempts: [Attempt]

    @State private var backendURL = Settings.backendURL
    @State private var apiToken = Keychain.apiToken ?? ""
    @State private var geminiKey = Keychain.geminiAPIKey ?? ""
    @State private var batchSize = Settings.dailyBatchSize
    @State private var productionRatio = Settings.productionRatio
    @State private var speakEnabled = Settings.speakEnabled
    @State private var healthMessage: String?
    @State private var checkingHealth = false

    var body: some View {
        NavigationStack {
            Form {
                backendSection
                if backendURL.trimmingCharacters(in: .whitespaces).isEmpty {
                    directSection
                }
                practiceSection
                audioSection
                storageSection
                aboutSection
            }
            .navigationTitle("Settings")
        }
    }

    // MARK: Backend

    private var backendSection: some View {
        Section {
            TextField("https://farsi-brain-....run.app", text: $backendURL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .onChange(of: backendURL) { _, new in Settings.backendURL = new }

            SecureField("Bearer token", text: $apiToken)
                .textInputAutocapitalization(.never)
                .onChange(of: apiToken) { _, new in Keychain.set(new, for: .apiToken) }

            Button {
                checkHealth()
            } label: {
                HStack {
                    Text("Test connection")
                    Spacer()
                    if checkingHealth { ProgressView() }
                }
            }
            .disabled(backendURL.isEmpty || checkingHealth)

            if let healthMessage {
                Text(healthMessage)
                    .font(.footnote)
                    .foregroundStyle(healthMessage.hasPrefix("OK") ? .green : .red)
            }
        } header: {
            Text("Backend")
        } footer: {
            Text("From `terraform output service_url`. Leave both blank to call Gemini directly from the phone instead — that path has no server-side usage cap.")
        }
    }

    // MARK: Direct mode

    /// Shown only when no backend is configured. Lets the app call Gemini
    /// straight from the phone, so it is fully usable before any GCP exists.
    private var directSection: some View {
        Section {
            SecureField("Gemini API key", text: $geminiKey)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: geminiKey) { _, new in Keychain.set(new, for: .geminiAPIKey) }
        } header: {
            Text("Direct mode")
        } footer: {
            Text("With no backend URL set, the app calls Gemini itself using this key. The key is stored in the Keychain on this device only, and there is no server-side usage cap — the client paces itself to stay under the free tier. Practising offline needs neither this nor a backend; only syncing does.")
        }
    }

    // MARK: Practice

    private var practiceSection: some View {
        Section {
            Stepper(
                "Daily batch: \(batchSize)",
                value: $batchSize, in: 10...200, step: 10
            )
            .onChange(of: batchSize) { _, new in Settings.dailyBatchSize = new }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("English → Farsi")
                    Spacer()
                    Text("\(Int(productionRatio * 100))%")
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                Slider(value: $productionRatio, in: 0.3...1.0, step: 0.05)
                    .onChange(of: productionRatio) { _, new in Settings.productionRatio = new }
            }
        } header: {
            Text("Practice")
        } footer: {
            Text("Producing Farsi is the skill that freezes; recognising it is easier. Weighted to production by default.")
        }
    }

    // MARK: Audio

    private var audioSection: some View {
        Section {
            Toggle("Read answers aloud", isOn: $speakEnabled)
                .onChange(of: speakEnabled) { _, new in Settings.speakEnabled = new }
                .disabled(!Speaker.isAvailable)

            if !Speaker.isAvailable {
                Text("No Persian voice is installed on this device. Add one in Settings → Accessibility → Spoken Content → Voices → Farsi.")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        } header: {
            Text("Audio")
        } footer: {
            Text("Apple supports Farsi speech synthesis but not Farsi dictation, so recordings are transcribed by Gemini at sync time rather than on-device.")
        }
    }

    // MARK: Storage

    private var storageSection: some View {
        Section("Storage") {
            LabeledContent("Sentences", value: "\(sentences.count)")
            LabeledContent("Attempts", value: "\(attempts.count)")
            LabeledContent("Waiting to sync", value: "\(attempts.filter(\.needsSync).count)")
            LabeledContent("Audio clips", value: formattedClipSize)
        }
    }

    private var formattedClipSize: String {
        ByteCountFormatter.string(fromByteCount: Recorder.totalClipBytes(), countStyle: .file)
    }

    private var aboutSection: some View {
        Section {
            LabeledContent("Error tags tracked", value: "\(ErrorTag.allCases.count)")
            if let last = Settings.lastSyncAt {
                LabeledContent("Last sync", value: last.formatted(date: .abbreviated, time: .shortened))
            }
        } header: {
            Text("About")
        }
    }

    // MARK: Health check

    private func checkHealth() {
        guard let url = URL(string: backendURL.trimmingCharacters(in: .whitespaces))?
            .appendingPathComponent("healthz")
        else {
            healthMessage = "That is not a valid URL."
            return
        }
        checkingHealth = true
        healthMessage = nil

        Task {
            defer { checkingHealth = false }
            do {
                let (data, response) = try await URLSession.shared.data(from: url)
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                if code == 200 {
                    let body = String(data: data, encoding: .utf8) ?? ""
                    healthMessage = "OK — service is up. \(body)"
                } else {
                    healthMessage = "Service replied HTTP \(code)."
                }
            } catch {
                healthMessage = error.localizedDescription
            }
        }
    }
}
