import UIKit
import WebKit
import AuthenticationServices

/// Native Sign in with Apple for the website running in the app's WebView.
///
/// The web Apple button cannot work in a WKWebView (Apple's page opens outside the app, so the
/// session lands in Safari), and Google refuses OAuth in one outright, so the app used to hide
/// every social button and make people create a username and password. Apple's own sheet works
/// in any app.
///
/// The page talks to it through `window.webkit.messageHandlers["apple-signin"]` and gets the
/// answer back as an `allfantasy:apple-signin` DOM event matched by `requestId` — the protocol in
/// lib/auth/apple-native-client.ts. One action, `signin`, carrying `nonce`: the SHA-256 (hex) of a
/// random value the page made. Apple puts it in the identity token and the server
/// (lib/auth/appleNativeSignIn.ts) checks it against the page's raw value.
///
/// The answer is the identity token plus the name Apple shares on the FIRST sign-in only. This
/// handler never decides who anyone is; the server verifies the token with Apple's keys.
///
/// Registered by AppBridgeViewController ONLY when the build carries the Sign in with Apple
/// entitlement (Info.plist `AFSignInWithApple`, written by ios-testflight.yml's
/// `sign_in_with_apple` input). Without the entitlement Apple's sheet fails with error 1000, so
/// a build that lacks it must not offer the button at all — the page shows it only when this
/// handler exists.
@MainActor
final class AppleSignInHandler: NSObject, WKScriptMessageHandler, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    static let messageName = "apple-signin"

    /// Pages allowed to ask. allfantasy.ai redirects to www, but both are first-party.
    private let allowedHosts: Set<String> = ["www.allfantasy.ai", "allfantasy.ai"]

    private weak var webView: WKWebView?
    private let windowScene: () -> UIWindowScene?
    /// The request in flight, if any. Apple's sheet is modal, so one at a time.
    private var pendingRequestId: String?
    private var controller: ASAuthorizationController?

    init(webView: WKWebView, windowScene: @escaping () -> UIWindowScene?) {
        self.webView = webView
        self.windowScene = windowScene
        super.init()
    }

    /// True when the signed build carries the Sign in with Apple entitlement.
    static var isEnabledInThisBuild: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "AFSignInWithApple") as? Bool) == true
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageName,
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              allowedHosts.contains(message.frameInfo.securityOrigin.host),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String,
              let requestId = body["requestId"] as? String else { return }

        guard action == "signin" else {
            send(["requestId": requestId, "error": "Unknown action."])
            return
        }
        guard let nonce = body["nonce"] as? String, nonce.count == 64 else {
            send(["requestId": requestId, "error": "Missing sign-in nonce."])
            return
        }
        if let previous = pendingRequestId {
            send(["requestId": previous, "cancelled": true])
        }
        pendingRequestId = requestId

        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonce
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        controller.performRequests()
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = webView?.window { return window }
        if let window = windowScene()?.windows.first(where: { $0.isKeyWindow }) { return window }
        return ASPresentationAnchor()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let requestId = pendingRequestId else { return }
        finish()
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            send(["requestId": requestId, "error": "Apple did not return a sign-in token."])
            return
        }
        var detail: [String: Any] = ["requestId": requestId, "identityToken": identityToken]
        let name = [credential.fullName?.givenName, credential.fullName?.familyName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if !name.isEmpty { detail["name"] = name }
        send(detail)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let requestId = pendingRequestId else { return }
        finish()
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            send(["requestId": requestId, "cancelled": true])
        } else {
            send(["requestId": requestId, "error": "Sign in with Apple didn't work. Please try again."])
        }
    }

    private func finish() {
        pendingRequestId = nil
        controller = nil
    }

    private func send(_ detail: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(detail),
              let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('allfantasy:apple-signin', {detail: \(json)}))",
            completionHandler: nil
        )
    }
}
