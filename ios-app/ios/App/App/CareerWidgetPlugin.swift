import Foundation
import Capacitor
import WidgetKit

/// The website's way to hand the Career widget its data (live-career plan, phase 6).
///
/// The web page calls `setSnapshot({ json })` through the bridge Capacitor injects
/// (lib/platform/careerWidgetBridge.ts); this stores the JSON in the shared App Group and asks
/// WidgetKit to redraw. The widget never touches the network or a session — it only ever shows
/// what the signed-in app last wrote here.
@objc(CareerWidgetPlugin)
public class CareerWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CareerWidgetPlugin"
    public let jsName = "CareerWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSnapshot", returnType: CAPPluginReturnPromise),
    ]

    /// A widget snapshot is a few hundred bytes; anything near this is not one.
    private static let maxBytes = 16_384

    @objc func setSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), !json.isEmpty, json.utf8.count <= Self.maxBytes else {
            call.reject("setSnapshot needs a JSON string under 16 KB")
            return
        }
        guard let defaults = UserDefaults(suiteName: CareerWidgetShared.appGroup) else {
            call.resolve(["stored": false])
            return
        }
        defaults.set(json, forKey: CareerWidgetShared.snapshotKey)
        WidgetCenter.shared.reloadTimelines(ofKind: CareerWidgetShared.kind)
        call.resolve(["stored": true])
    }
}
