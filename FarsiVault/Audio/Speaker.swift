import AVFoundation
import Foundation

/// Reads reference sentences aloud in Persian.
///
/// Apple does not support Persian *dictation* (speech-to-text) — confirmed
/// absent from the iOS Dictation language list — but Farsi IS supported for
/// VoiceOver / Live Speech / Read & Speak, so synthesis works. That asymmetry
/// is why recognition goes to Gemini while playback stays on-device and free.
///
/// The fa-IR voice is not guaranteed to be installed, so `isAvailable` is
/// checked at launch and the UI hides playback rather than failing silently.
@MainActor
final class Speaker: NSObject, ObservableObject {
    static let shared = Speaker()

    @Published private(set) var isSpeaking = false

    private let synthesizer = AVSpeechSynthesizer()

    /// Persian voices, best first. Apple has shipped both identifiers.
    private static let preferredLanguages = ["fa-IR", "fa"]

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// Whether any Persian voice is installed on this device.
    static var isAvailable: Bool { persianVoice() != nil }

    static func persianVoice() -> AVSpeechSynthesisVoice? {
        for language in preferredLanguages {
            if let voice = AVSpeechSynthesisVoice(language: language) { return voice }
        }
        // Fall back to scanning, in case the identifier differs on this OS version.
        return AVSpeechSynthesisVoice.speechVoices().first {
            $0.language.lowercased().hasPrefix("fa")
        }
    }

    func speak(_ text: String, rate: Float = 0.42) {
        guard Settings.speakEnabled, let voice = Self.persianVoice() else { return }
        stop()

        configureSession()

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        // Default rate is too quick to shadow along with; this is closer to
        // careful conversational speed.
        utterance.rate = rate
        utterance.postUtteranceDelay = 0.1
        synthesizer.speak(utterance)
    }

    func stop() {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
    }

    /// Play alongside the user's music/podcast rather than interrupting it —
    /// this app is used on a commute, often with something else already playing.
    private func configureSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? session.setActive(true, options: [])
    }
}

extension Speaker: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didStart utterance: AVSpeechUtterance
    ) {
        Task { @MainActor in self.isSpeaking = true }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        Task { @MainActor in
            self.isSpeaking = false
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance
    ) {
        Task { @MainActor in self.isSpeaking = false }
    }
}
