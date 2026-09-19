import Foundation
import Security

/// Keychain-backed secret storage.
///
/// The bearer token authenticates every backend call, so it does not belong in
/// UserDefaults (plist, readable from a backup). The backend URL is not secret
/// and lives in UserDefaults.
enum Keychain {
    private static let service = "com.farsivault.secrets"

    enum Key: String {
        case apiToken = "backend-api-token"
        case geminiAPIKey = "gemini-api-key"
    }

    static func set(_ value: String?, for key: Key) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        SecItemDelete(query as CFDictionary)

        guard let value, !value.isEmpty, let data = value.data(using: .utf8) else { return }

        var insert = query
        insert[kSecValueData as String] = data
        // Device-only, unlocked-only: never syncs, never readable while locked.
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
    }

    static func get(_ key: Key) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let string = String(data: data, encoding: .utf8)
        else { return nil }
        return string
    }

    static var apiToken: String? { Self.get(.apiToken) }
    static var geminiAPIKey: String? { Self.get(.geminiAPIKey) }
}

/// Non-secret settings.
enum Settings {
    private static let defaults = UserDefaults.standard

    enum Key: String {
        case backendURL = "backendURL"
        case dailyBatchSize = "dailyBatchSize"
        case productionRatio = "productionRatio"   // share of cards that are EN→FA
        case speakEnabled = "speakEnabled"
        case lastSyncAt = "lastSyncAt"
    }

    static var backendURL: String {
        get { defaults.string(forKey: Key.backendURL.rawValue) ?? "" }
        set { defaults.set(newValue, forKey: Key.backendURL.rawValue) }
    }

    static var dailyBatchSize: Int {
        get {
            let stored = defaults.integer(forKey: Key.dailyBatchSize.rawValue)
            return stored == 0 ? 100 : stored
        }
        set { defaults.set(newValue, forKey: Key.dailyBatchSize.rawValue) }
    }

    /// Weighted to production: freezing happens when speaking, not when reading.
    static var productionRatio: Double {
        get {
            let stored = defaults.double(forKey: Key.productionRatio.rawValue)
            return stored == 0 ? 0.7 : stored
        }
        set { defaults.set(newValue, forKey: Key.productionRatio.rawValue) }
    }

    static var speakEnabled: Bool {
        get { defaults.object(forKey: Key.speakEnabled.rawValue) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Key.speakEnabled.rawValue) }
    }

    static var lastSyncAt: Date? {
        get { defaults.object(forKey: Key.lastSyncAt.rawValue) as? Date }
        set { defaults.set(newValue, forKey: Key.lastSyncAt.rawValue) }
    }

    static var isConfigured: Bool {
        !backendURL.isEmpty && Keychain.apiToken?.isEmpty == false
    }
}
