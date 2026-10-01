import Foundation
import UserNotifications

/// Puts the picture on a push: a player headshot, or the trade card.
///
/// The server (lib/push-notifications/apns.ts) sends `imageUrl` and sets `mutable-content: 1`
/// ONLY when an alert has a picture, so iOS hands exactly those alerts here before showing them.
/// This downloads the image and attaches it. Anything that goes wrong — no URL, a slow network,
/// bytes that are not an image — delivers the alert exactly as it arrived: the text always shows,
/// a picture never costs it.
///
/// iOS gives an extension about 30 seconds and a small memory budget; the download is capped well
/// inside both.
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?
    private var task: URLSessionDataTask?

    /// Larger than any card (~60 KB) or headshot (~20 KB) the server makes; an attachment this big
    /// is either a mistake or not ours.
    private static let maxBytes = 2_000_000

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        bestAttempt = content

        guard
            let raw = request.content.userInfo["imageUrl"] as? String,
            let url = URL(string: raw),
            url.scheme == "https"
        else {
            finish()
            return
        }

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        task = URLSession(configuration: config).dataTask(with: url) { [weak self] data, response, _ in
            guard let self else { return }
            if
                let data,
                data.count > 0, data.count <= Self.maxBytes,
                (response as? HTTPURLResponse)?.statusCode == 200,
                let attachment = Self.attachment(from: data)
            {
                self.lock.lock()
                self.bestAttempt?.attachments = [attachment]
                self.lock.unlock()
            }
            self.finish()
        }
        task?.resume()
    }

    /// iOS is about to give up on us: show what we have, which is at worst the original text.
    override func serviceExtensionTimeWillExpire() {
        task?.cancel()
        finish()
    }

    /// The download callback (a background queue) and the expiry callback can race; the handler
    /// must run exactly once, so the hand-off is taken under a lock.
    private let lock = NSLock()

    private func finish() {
        lock.lock()
        let handler = contentHandler
        contentHandler = nil
        let content = bestAttempt
        lock.unlock()
        if let handler, let content { handler(content) }
    }

    /// 🛑 THE FILE TYPE COMES FROM THE BYTES, NOT THE URL OR THE HEADER. Sleeper's CDN serves PNG
    /// bytes from `.jpg` URLs labelled `image/jpeg` (measured 2026-10-01), and iOS picks the decoder
    /// from the attachment's extension and type hint. A wrong label drops the picture.
    static func attachment(from data: Data) -> UNNotificationAttachment? {
        let bytes = [UInt8](data.prefix(8))
        let type: (ext: String, uti: String)
        if bytes.count >= 4, bytes[0] == 0x89, bytes[1] == 0x50, bytes[2] == 0x4E, bytes[3] == 0x47 {
            type = ("png", "public.png")
        } else if bytes.count >= 3, bytes[0] == 0xFF, bytes[1] == 0xD8, bytes[2] == 0xFF {
            type = ("jpg", "public.jpeg")
        } else {
            return nil
        }
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(type.ext)
        do {
            try data.write(to: file)
            // iOS moves the file into its own store when the attachment is created.
            return try UNNotificationAttachment(
                identifier: "image",
                url: file,
                options: [UNNotificationAttachmentOptionsTypeHintKey: type.uti]
            )
        } catch {
            return nil
        }
    }
}
