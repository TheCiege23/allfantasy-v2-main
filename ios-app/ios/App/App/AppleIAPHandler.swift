import UIKit
import WebKit
import StoreKit

/// Apple in-app purchase for the website running in the app's WebView (App Store guideline 3.1.1).
///
/// The page talks to it through `window.webkit.messageHandlers["apple-iap"]` and gets answers back
/// as `allfantasy:apple-iap` DOM events, matched by `requestId` — the protocol in
/// lib/monetization/apple-iap-client.ts. Actions: `products`, `purchase`, `restore`, `manage`,
/// `finish`.
///
/// 🛑 A TRANSACTION IS FINISHED ONLY AFTER OUR SERVER HAS GRANTED IT. `purchase` and `restore` hand
/// the page Apple's signed transaction; the page posts it to /api/monetization/apple/transactions,
/// which verifies it with Apple and grants the plan or tokens; only then does the page send
/// `finish`. Finishing earlier would let StoreKit forget a consumable the account never received.
///
/// Registered on Capacitor's WebView by AppBridgeViewController. The app's User-Agent carries the
/// `AFIAP` marker (capacitor.config.json) so the website knows this build can buy; keep the two
/// together — a marker without this handler reopens pricing pages that cannot check out.
@MainActor
final class AppleIAPHandler: NSObject, WKScriptMessageHandler {
    static let messageName = "apple-iap"

    /// Must match the App Store Connect product IDs and lib/monetization/catalog.ts.
    private let productIDs: Set<String> = [
        "af_pro_monthly", "af_pro_yearly", "af_commissioner_monthly", "af_commissioner_yearly",
        "af_war_room_monthly", "af_war_room_yearly", "af_supreme_monthly", "af_supreme_yearly",
        "af_tokens_5", "af_tokens_10", "af_tokens_25",
    ]
    /// Pages allowed to start a purchase. allfantasy.ai redirects to www, but both are first-party.
    private let allowedHosts: Set<String> = ["www.allfantasy.ai", "allfantasy.ai"]

    private weak var webView: WKWebView?
    private let windowScene: () -> UIWindowScene?
    private var pendingTransactions: [UInt64: Transaction] = [:]

    /// Lives as long as the app: WKUserContentController retains its message handlers.
    init(webView: WKWebView, windowScene: @escaping () -> UIWindowScene?) {
        self.webView = webView
        self.windowScene = windowScene
        super.init()
        Task { [weak self] in await self?.listenForUpdates() }
    }

    /// Purchases that complete outside a `purchase` call: renewals, Ask to Buy approvals, a purchase
    /// interrupted by the app closing. Apple asks every app to listen for these from launch.
    /// Subscriptions are granted server-side by App Store Server Notifications, so they are finished
    /// here. Consumables are NOT: nothing has granted them yet, so they stay unfinished and the next
    /// Restore Purchases (Transaction.unfinished) hands them to the server.
    private func listenForUpdates() async {
        for await result in Transaction.updates {
            guard case .verified(let transaction) = result,
                  productIDs.contains(transaction.productID) else { continue }
            if transaction.productType == .autoRenewable {
                await transaction.finish()
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Other pages opened in the web view must never initiate a purchase.
        guard message.name == Self.messageName,
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              allowedHosts.contains(message.frameInfo.securityOrigin.host),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String,
              let requestId = body["requestId"] as? String else { return }

        Task {
            await self.handle(action: action, requestId: requestId, body: body)
        }
    }

    private func handle(action: String, requestId: String, body: [String: Any]) async {
        do {
            switch action {
            case "finish":
                guard let transactionId = body["transactionId"] as? String,
                      let id = UInt64(transactionId) else { return }
                if let transaction = pendingTransactions.removeValue(forKey: id) {
                    await transaction.finish()
                }

            case "products":
                let products = try await Product.products(for: productIDs)
                send(["requestId": requestId, "products": products.map {
                    ["id": $0.id, "displayPrice": $0.displayPrice, "displayName": $0.displayName]
                }])

            case "manage":
                guard let scene = windowScene() else {
                    send(["requestId": requestId, "error": "Subscription settings are unavailable."])
                    return
                }
                try await AppStore.showManageSubscriptions(in: scene)
                send(["requestId": requestId])

            case "restore":
                try await AppStore.sync()
                var transactions: [[String: String]] = []
                var seen: Set<UInt64> = []
                for await result in Transaction.currentEntitlements {
                    if case .verified(let transaction) = result,
                       productIDs.contains(transaction.productID),
                       seen.insert(transaction.id).inserted {
                        transactions.append(payload(transaction, jws: result.jwsRepresentation))
                    }
                }
                // Consumables are absent from currentEntitlements. Recover purchases that were not
                // finished because the server grant failed, the app closed, or they arrived through
                // Transaction.updates.
                for await result in Transaction.unfinished {
                    if case .verified(let transaction) = result,
                       productIDs.contains(transaction.productID),
                       seen.insert(transaction.id).inserted {
                        pendingTransactions[transaction.id] = transaction
                        transactions.append(payload(transaction, jws: result.jwsRepresentation))
                    }
                }
                send(["requestId": requestId, "transactions": transactions])

            case "purchase":
                guard let productId = body["productId"] as? String,
                      productIDs.contains(productId),
                      let accountTokenText = body["appAccountToken"] as? String,
                      let accountToken = UUID(uuidString: accountTokenText),
                      let product = try await Product.products(for: [productId]).first else {
                    send(["requestId": requestId, "error": "This Apple product is unavailable."])
                    return
                }
                let purchase = try await product.purchase(options: [.appAccountToken(accountToken)])
                switch purchase {
                case .success(let result):
                    guard case .verified(let transaction) = result else {
                        send(["requestId": requestId, "error": "Apple could not verify the purchase."])
                        return
                    }
                    pendingTransactions[transaction.id] = transaction
                    // The web client verifies and grants the transaction on our server before finish.
                    var detail: [String: Any] = payload(transaction, jws: result.jwsRepresentation)
                    detail["requestId"] = requestId
                    send(detail)
                case .userCancelled:
                    send(["requestId": requestId, "cancelled": true])
                case .pending:
                    send(["requestId": requestId, "error": "Purchase is pending Apple approval."])
                @unknown default:
                    send(["requestId": requestId, "error": "Unable to complete purchase."])
                }

            default:
                send(["requestId": requestId, "error": "Unknown purchase action."])
            }
        } catch {
            send(["requestId": requestId, "error": error.localizedDescription])
        }
    }

    private func payload(_ transaction: Transaction, jws: String) -> [String: String] {
        ["productId": transaction.productID,
         "transactionId": String(transaction.id),
         "signedTransactionInfo": jws]
    }

    private func send(_ detail: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(detail),
              let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('allfantasy:apple-iap', {detail: \(json)}))",
            completionHandler: nil
        )
    }
}
