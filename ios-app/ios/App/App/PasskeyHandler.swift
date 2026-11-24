import UIKit
import WebKit
import AuthenticationServices

/// Face ID passkeys for the website running in the app's WebView (lib/auth/passkeys.ts on the
/// server; lib/auth/native-passkey-bridge.ts on the page).
///
/// The page's WebAuthn calls do not reach Face ID inside this WKWebView, so the page asks this
/// handler instead, through `window.webkit.messageHandlers["passkey"]`, and gets the answer back as
/// an `allfantasy:passkey` DOM event matched by `requestId`.
///
/// Two actions, both carrying the server's challenge and the relying party `rpId`
/// (www.allfantasy.ai):
///   `register`      also `userId` and `userName` — makes a passkey (Face ID) for the signed-in account
///   `authenticate`  signs the challenge with a passkey the person picks (Face ID)
/// Every binary value crosses the bridge as base64url, the shape the server's WebAuthn library reads.
///
/// THE PASSKEY IS THE WEBSITE'S: the app may use passkeys for www.allfantasy.ai only because the
/// site's apple-app-site-association lists this app under `webcredentials`
/// (lib/platform/appSiteAssociation.ts) AND this build carries `webcredentials:www.allfantasy.ai`
/// in its associated-domains entitlement. So a passkey made in Safari works here and the reverse.
/// This handler decides nothing about who anyone is; the server verifies every signature.
///
/// Registered by AppBridgeViewController ONLY when the build carries that entitlement (Info.plist
/// `AFPasskeys`, written by ios-testflight.yml's `passkeys` input) and on iOS 16+. Without the
/// entitlement Apple's sheet fails, so a build that lacks it must not offer the button — the page
/// offers Face ID only when this handler exists.
@available(iOS 16.0, *)
@MainActor
final class PasskeyHandler: NSObject, WKScriptMessageHandler, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    static let messageName = "passkey"

    /// Pages allowed to ask, and the only relying party a passkey may be made for.
    private let allowedHosts: Set<String> = ["www.allfantasy.ai", "allfantasy.ai"]
    private let allowedRpId = "www.allfantasy.ai"

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

    /// True when the signed build carries `webcredentials:` for the site.
    static var isEnabledInThisBuild: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "AFPasskeys") as? Bool) == true
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageName,
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              allowedHosts.contains(message.frameInfo.securityOrigin.host),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String,
              let requestId = body["requestId"] as? String else { return }

        guard let rpId = body["rpId"] as? String, rpId == allowedRpId else {
            send(["requestId": requestId, "error": "This sign-in isn't available here."])
            return
        }
        guard let challengeText = body["challenge"] as? String, let challenge = Self.decode(challengeText) else {
            send(["requestId": requestId, "error": "Missing sign-in challenge."])
            return
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request: ASAuthorizationRequest
        switch action {
        case "register":
            guard let userIdText = body["userId"] as? String, let userId = Self.decode(userIdText),
                  let userName = body["userName"] as? String, !userName.isEmpty else {
                send(["requestId": requestId, "error": "Missing account details."])
                return
            }
            let registration = provider.createCredentialRegistrationRequest(challenge: challenge, name: userName, userID: userId)
            registration.userVerificationPreference = .required
            request = registration
        case "authenticate":
            let assertion = provider.createCredentialAssertionRequest(challenge: challenge)
            assertion.userVerificationPreference = .required
            request = assertion
        default:
            send(["requestId": requestId, "error": "Unknown action."])
            return
        }

        if let previous = pendingRequestId {
            send(["requestId": previous, "cancelled": true])
        }
        pendingRequestId = requestId

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
        if let made = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            guard let attestation = made.rawAttestationObject else {
                send(["requestId": requestId, "error": "Face ID didn't return a passkey. Please try again."])
                return
            }
            send([
                "requestId": requestId,
                "kind": "registration",
                "credentialId": Self.encode(made.credentialID),
                "clientDataJSON": Self.encode(made.rawClientDataJSON),
                "attestationObject": Self.encode(attestation),
            ])
            return
        }
        if let used = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            var detail: [String: Any] = [
                "requestId": requestId,
                "kind": "assertion",
                "credentialId": Self.encode(used.credentialID),
                "clientDataJSON": Self.encode(used.rawClientDataJSON),
                "authenticatorData": Self.encode(used.rawAuthenticatorData),
                "signature": Self.encode(used.signature),
            ]
            if let userId = used.userID, !userId.isEmpty { detail["userHandle"] = Self.encode(userId) }
            send(detail)
            return
        }
        send(["requestId": requestId, "error": "Face ID didn't work. Please try again."])
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let requestId = pendingRequestId else { return }
        finish()
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            // Also what Apple reports when no saved passkey matches: not a failure to shout about.
            send(["requestId": requestId, "cancelled": true])
        } else {
            send(["requestId": requestId, "error": "Face ID didn't work. Please try again."])
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
            "window.dispatchEvent(new CustomEvent('allfantasy:passkey', {detail: \(json)}))",
            completionHandler: nil
        )
    }

    // MARK: base64url, the WebAuthn wire format

    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ text: String) -> Data? {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        guard let data = Data(base64Encoded: base64), !data.isEmpty else { return nil }
        return data
    }
}
