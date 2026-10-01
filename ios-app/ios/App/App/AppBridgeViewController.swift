import UIKit
import Capacitor

/// The app's root view controller: Capacitor's bridge, plus the plugins that live in this app
/// rather than in an npm package. Registered in `capacitorDidLoad`, which is Capacitor's documented
/// hook for local plugins.
class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(CareerWidgetPlugin())
    }
}
