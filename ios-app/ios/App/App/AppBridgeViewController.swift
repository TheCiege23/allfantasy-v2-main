import UIKit
import Capacitor

/// The app's root view controller: Capacitor's bridge, plus the plugins that live in this app
/// rather than in an npm package. Registered in `capacitorDidLoad`, which is Capacitor's documented
/// hook for local plugins.
///
/// Apple in-app purchase is a plain WKScriptMessageHandler rather than a Capacitor plugin: the
/// website's client (lib/monetization/apple-iap-client.ts) speaks `messageHandlers["apple-iap"]`,
/// so the same page works without loading Capacitor's JS.
class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(CareerWidgetPlugin())
        if let webView = bridge?.webView {
            let appleIAP = AppleIAPHandler(webView: webView) { [weak self] in
                self?.view.window?.windowScene
            }
            webView.configuration.userContentController.add(appleIAP, name: AppleIAPHandler.messageName)
        }
    }
}
