import WidgetKit
import SwiftUI

/// AllFantasy "Your career" home-screen widget (live-career plan, phase 6).
///
/// It shows only what the signed-in app last wrote to the shared App Group
/// (`CareerWidgetPlugin.setSnapshot`, fed by lib/core-app/careerWidgetSnapshot.ts). No network, no
/// session, no guessing: with no snapshot it says to open the app, and it always says when its
/// numbers were last updated, because a widget that looks live but is days old is the failure the
/// Career screen's own "we read" wording exists to prevent.

struct CareerSnapshot: Codable {
    let v: Int
    let handle: String?
    let level: Int?
    let levelName: String?
    let titles: Int
    let record: String?
    let nextTitle: String?
    let nextShort: String?
    let stakeTitle: String?
    let stakeRing: Int?
    let updatedAt: String

    static let sample = CareerSnapshot(
        v: 1, handle: "you", level: 14, levelName: "All-Pro", titles: 6, record: "253-139",
        nextTitle: "Ring Collector Gold", nextShort: "1 title to go",
        stakeTitle: "Win Dynasty Dragons", stakeRing: 7, updatedAt: ISO8601DateFormatter().string(from: Date())
    )

    var updatedDate: Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: updatedAt) ?? ISO8601DateFormatter().date(from: updatedAt)
    }
}

struct CareerEntry: TimelineEntry {
    let date: Date
    let snapshot: CareerSnapshot?
}

struct CareerProvider: TimelineProvider {
    func placeholder(in context: Context) -> CareerEntry {
        CareerEntry(date: Date(), snapshot: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (CareerEntry) -> Void) {
        completion(CareerEntry(date: Date(), snapshot: context.isPreview ? .sample : load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CareerEntry>) -> Void) {
        // The app reloads this timeline whenever it writes a new snapshot; the periodic refresh
        // only keeps the "updated … ago" line honest.
        let entry = CareerEntry(date: Date(), snapshot: load())
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(6 * 60 * 60))))
    }

    private func load() -> CareerSnapshot? {
        guard
            let json = UserDefaults(suiteName: CareerWidgetShared.appGroup)?.string(forKey: CareerWidgetShared.snapshotKey),
            let data = json.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(CareerSnapshot.self, from: data)
    }
}

private enum Palette {
    static let background = Color(red: 0.008, green: 0.024, blue: 0.090)
    static let accent = Color(red: 0.133, green: 0.827, blue: 0.933)
    static let gold = Color(red: 0.965, green: 0.769, blue: 0.271)
    static let muted = Color(white: 0.62)
}

extension View {
    @ViewBuilder
    func careerWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(Palette.background, for: .widget)
        } else {
            background(Palette.background)
        }
    }
}

struct CareerWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: CareerEntry

    var body: some View {
        Group {
            if let s = entry.snapshot {
                if family == .systemMedium { medium(s) } else { small(s) }
            } else {
                empty
            }
        }
        .careerWidgetBackground()
        .widgetURL(URL(string: "https://allfantasy.ai/core/career"))
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("YOUR CAREER").font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundColor(Palette.accent)
            Text("Open AllFantasy to load your career.").font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func header(_ s: CareerSnapshot) -> some View {
        Text(s.levelName.map { "\($0.uppercased())" } ?? "YOUR CAREER")
            .font(.system(size: 11, weight: .bold, design: .monospaced))
            .foregroundColor(Palette.accent)
            .lineLimit(1)
    }

    private func titles(_ s: CareerSnapshot) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(s.titles)").font(.system(size: 30, weight: .heavy, design: .rounded)).foregroundColor(Palette.gold)
            Text(s.titles == 1 ? "title" : "titles").font(.system(size: 12, weight: .semibold)).foregroundColor(Palette.muted)
        }
    }

    private func updated(_ s: CareerSnapshot) -> some View {
        Group {
            if let d = s.updatedDate {
                (Text("Updated ") + Text(d, style: .relative) + Text(" ago"))
            } else {
                Text("Open the app to update")
            }
        }
        .font(.system(size: 11))
        .foregroundColor(Palette.muted)
        .lineLimit(1)
    }

    private func small(_ s: CareerSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            header(s)
            titles(s)
            if let next = s.nextTitle {
                Text(next).font(.system(size: 12, weight: .semibold)).foregroundColor(.white).lineLimit(2)
                if let short = s.nextShort { Text(short).font(.system(size: 11)).foregroundColor(Palette.muted).lineLimit(1) }
            } else if let record = s.record {
                Text(record).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundColor(.white)
            }
            Spacer(minLength: 0)
            updated(s)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func medium(_ s: CareerSnapshot) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                header(s)
                titles(s)
                if let record = s.record {
                    Text(record).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundColor(.white)
                }
                Spacer(minLength: 0)
                updated(s)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 8) {
                if let stake = s.stakeTitle {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("IN PLAY").font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundColor(Palette.gold)
                        Text(stake).font(.system(size: 13, weight: .semibold)).foregroundColor(.white).lineLimit(2)
                        if let ring = s.stakeRing {
                            Text("would be ring #\(ring)").font(.system(size: 11)).foregroundColor(Palette.muted)
                        }
                    }
                }
                if let next = s.nextTitle {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("WITHIN REACH").font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundColor(Palette.accent)
                        Text(next).font(.system(size: 13, weight: .semibold)).foregroundColor(.white).lineLimit(1)
                        if let short = s.nextShort { Text(short).font(.system(size: 11)).foregroundColor(Palette.muted).lineLimit(1) }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct CareerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: CareerWidgetShared.kind, provider: CareerProvider()) { entry in
            CareerWidgetView(entry: entry)
        }
        .configurationDisplayName("Your career")
        .description("Your level, titles, and what's in play this season.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct CareerWidgetBundle: WidgetBundle {
    var body: some Widget {
        CareerWidget()
    }
}
