import Foundation

/// Names the app and the Career widget extension must agree on (live-career plan, phase 6).
///
/// Compiled into BOTH targets: the app writes the snapshot, the widget reads it. The App Group is
/// only granted on builds with the career widget switched on (`career_widget` in
/// .github/workflows/ios-testflight.yml); without it `UserDefaults(suiteName:)` still answers, but
/// with storage private to the app, so the write is harmless and simply never seen by a widget.
enum CareerWidgetShared {
    static let appGroup = "group.ai.allfantasy.app"
    static let snapshotKey = "careerWidgetSnapshot"
    static let kind = "CareerWidget"
}
