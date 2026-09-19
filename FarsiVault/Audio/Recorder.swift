import AVFoundation
import Foundation

/// Records spoken answers for later grading.
///
/// Clips are written to Application Support and kept until they have been
/// graded and the grade is at least a week old (see `pruneGraded`). They are
/// uploaded base64-encoded inside the sync payload; there is no separate
/// upload step, and nothing leaves the device until you tap Sync.
@MainActor
final class Recorder: NSObject, ObservableObject {
    static let shared = Recorder()

    @Published private(set) var isRecording = false
    @Published private(set) var permissionDenied = false

    private var recorder: AVAudioRecorder?

    /// Mono 22kHz AAC. Speech does not need more, and clip size drives both
    /// upload time and Gemini token cost.
    private static let settings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 22_050.0,
        AVNumberOfChannelsKey: 1,
        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
    ]

    static var clipsDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("clips", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func url(for filename: String) -> URL {
        clipsDirectory.appendingPathComponent(filename)
    }

    func requestPermission() async -> Bool {
        let granted = await AVAudioApplication.requestRecordPermission()
        permissionDenied = !granted
        return granted
    }

    /// Begin recording. Returns the filename to store on the Attempt, or nil.
    @discardableResult
    func start() async -> String? {
        guard await requestPermission() else { return nil }
        stop()

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch {
            return nil
        }

        let filename = "\(UUID().uuidString).m4a"
        do {
            let recorder = try AVAudioRecorder(url: Self.url(for: filename), settings: Self.settings)
            recorder.delegate = self
            guard recorder.record() else { return nil }
            self.recorder = recorder
            isRecording = true
            return filename
        } catch {
            return nil
        }
    }

    func stop() {
        recorder?.stop()
        recorder = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    /// Read a clip as base64 for the sync payload.
    static func base64(for filename: String) -> String? {
        try? Data(contentsOf: url(for: filename)).base64EncodedString()
    }

    static func delete(_ filename: String) {
        try? FileManager.default.removeItem(at: url(for: filename))
    }

    /// Remove clips whose attempts were graded more than `olderThan` ago.
    ///
    /// Without this, audio accumulates indefinitely — 100 clips a day at ~40KB
    /// is over a gigabyte a year on a device you cannot easily clear.
    static func pruneGraded(filenames: [String]) {
        for filename in filenames { delete(filename) }
    }

    static func totalClipBytes() -> Int64 {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: clipsDirectory, includingPropertiesForKeys: [.fileSizeKey]
        )) ?? []
        return files.reduce(into: Int64(0)) { total, url in
            total += Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
    }
}

extension Recorder: AVAudioRecorderDelegate {
    nonisolated func audioRecorderDidFinishRecording(
        _ recorder: AVAudioRecorder,
        successfully flag: Bool
    ) {
        Task { @MainActor in self.isRecording = false }
    }
}
