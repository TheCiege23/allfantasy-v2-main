import Link from "next/link"

import {
  APP_PLATFORM_LABEL,
  APP_PLATFORMS,
  APP_WINDOWS,
  cameBackRate,
  NEW_USER_LOOKBACK_DAYS,
  type AppPlatformKey,
  type AppPlatformReport,
  type DailyRow,
} from "@/lib/admin-dashboard/appPlatformStats"
import type { StoreCard } from "@/lib/admin-dashboard/storeDownloads"

/**
 * /admin/apps — the view only (data: lib/admin-dashboard/AppPlatformStatsService.ts for
 * people, from our own database; lib/admin-dashboard/storeDownloads.ts for downloads).
 * Series colours: categorical slots 1–3 (dark steps), validated against this page's
 * #020817 surface; "Not labelled yet" is a neutral grey, never a fourth hue. The App
 * Store and Google Play cards reuse the iOS and Android colours.
 */
const COLOR: Record<AppPlatformKey, string> = {
  ios_app: "#3987e5",
  android_app: "#d95926",
  web: "#199e70",
  unlabelled: "#64748b",
}

const STORE_COLOR: Record<StoreCard["store"], string> = { apple: COLOR.ios_app, google: COLOR.android_app }

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"))

export function AppPlatformDashboard({ days, report, stores }: { days: number; report: AppPlatformReport; stores: StoreCard[] }) {
  const errors = [...new Set(report.errors)]
  const since = report.countingSince ? report.countingSince.slice(0, 10) : null
  // Until the lookback has filled up, "new" also includes everyone already using the app.
  const newIsPartial = since ? Date.parse(report.generatedAt) - Date.parse(`${since}T00:00:00Z`) < NEW_USER_LOOKBACK_DAYS * 86_400_000 : false

  return (
    <Frame days={days}>
      {errors.length ? (
        <ul className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" data-testid="admin-apps-errors">
          {errors.map((e) => <li key={e}>{e} — that part is left out rather than shown as zero.</li>)}
        </ul>
      ) : null}

      {since || errors.length ? (
        <>
          <p className="text-3xl font-black" data-testid="admin-apps-headline">
            {fmt(report.totalActive)} <span className="text-lg font-semibold text-white/70">people used AllFantasy in the last {days} days</span>
          </p>
          {since ? <p className="-mt-3 text-xs text-white/55" data-testid="admin-apps-since">Counting since {shortDay(since)}.</p> : null}

          <div className="grid gap-3 sm:grid-cols-3" data-testid="admin-apps-platforms">
            {report.platforms.filter((p) => p.platform !== "unlabelled").map((p) => (
              <div key={p.platform} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" data-platform={p.platform}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR[p.platform] }} />
                  {p.label}
                </div>
                <div className="mt-1 text-3xl font-black">{fmt(p.active)}</div>
                <div className="text-xs text-white/55">active</div>
                <div className="mt-3 text-sm text-white/75">
                  {fmt(p.newUsers)} new · {cameBackRate(p)} came back
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/75" data-testid="admin-apps-empty">
          No app opens recorded yet. Counting starts as soon as people open AllFantasy after this update goes live.
        </p>
      )}

      <Section title={`Downloads, last ${days} days`} hint="From each store's own reports. Both stores publish a day or more late, so each card says how recent it is.">
        <div className="grid gap-3 sm:grid-cols-2" data-testid="admin-apps-downloads">
          {stores.map((s) => <StoreDownloadCard key={s.store} card={s} />)}
        </div>
      </Section>

      {since ? (
        <Section title="People each day" hint="One bar per day (UTC). Hover a segment for its number.">
          {report.daily ? <DailyChart rows={report.daily} /> : <p className="text-sm text-white/50">The daily chart couldn&apos;t load.</p>}
        </Section>
      ) : null}

      <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/65">
        <summary className="cursor-pointer font-semibold text-white/80">How these are counted</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Active</b>: devices that opened AllFantasy in the window. Someone who used two platforms counts on both, so the cards can add up to more than the headline.</li>
          <li><b>New</b>: first seen in the window, with no visit in the {NEW_USER_LOOKBACK_DAYS} days before. Counted on the platform they arrived on.{newIsPartial ? ` Counting started ${since ? shortDay(since) : "recently"}, so until ${NEW_USER_LOOKBACK_DAYS} days have passed this also includes people who were already using AllFantasy.` : ""}</li>
          <li><b>Came back</b>: of those new people, the share who returned on a later day. Recent arrivals have had less time, so it reads low for short windows.</li>
          <li><b>App Store downloads</b>: first-time downloads from Apple&apos;s daily sales reports (Pacific days). Re-downloads are people installing again on a new or reset device.</li>
          <li><b>Google Play downloads</b>: daily user installs from the Play Console export, over the {days} days ending on its newest day.</li>
          <li>People counts come from our own database: each device sends one &ldquo;app opened&rdquo; note a day. One person on two devices counts twice, and clearing cookies counts as a new device.</li>
        </ul>
      </details>
    </Frame>
  )
}

const STORE_SETUP: Record<StoreCard["store"], string[]> = {
  apple: [
    "App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys: create a key with the Sales role and download the .p8 file.",
    "Note the Key ID, the Issuer ID above the key list, and the vendor number (Payments and Financial Reports, top left).",
    "In Railway (allfantasy-v2-main) add APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_PRIVATE_KEY (the .p8 contents) and APP_STORE_CONNECT_VENDOR_NUMBER.",
  ],
  google: [
    "Google Cloud: create a service account and download a JSON key for it.",
    "Play Console → Users and permissions: invite the service account's email with “View app information and download bulk reports”.",
    "Play Console → Download reports → Statistics: copy the Cloud Storage URI (gs://pubsite_prod_…). In Railway add GOOGLE_PLAY_SERVICE_ACCOUNT_JSON and GOOGLE_PLAY_REPORTS_BUCKET.",
  ],
}

function StoreDownloadCard({ card }: { card: StoreCard }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" data-store={card.store} data-state={card.state}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: STORE_COLOR[card.store] }} />
          {card.label}
        </div>
        <a href={card.consoleUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300/80">Open ↗</a>
      </div>
      {card.state === "ok" ? (
        <>
          <div className="mt-1 text-3xl font-black">{fmt(card.count)}</div>
          <div className="text-xs text-white/55">downloads{card.through ? ` · through ${shortDay(card.through)}` : ""}</div>
          {card.detail ? <div className="mt-3 text-sm text-white/75">{card.detail}</div> : null}
        </>
      ) : card.state === "error" ? (
        <p className="mt-2 text-sm text-amber-200">Couldn&apos;t read the report: {card.problem}</p>
      ) : (
        <div className="mt-2 text-sm text-white/70">
          <p>Not connected yet.</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-cyan-300/80">How to connect</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-white/65">
              {STORE_SETUP[card.store].map((step) => <li key={step}>{step}</li>)}
            </ol>
          </details>
        </div>
      )}
    </div>
  )
}

function Frame({ days, children }: { days: number; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8 sm:px-6" data-testid="admin-apps">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/admin" className="text-xs text-cyan-300/80">← Admin</Link>
            <h1 className="mt-1 text-2xl font-black">Apps</h1>
            <p className="text-sm text-white/60">Who uses AllFantasy in the iOS app, the Android app and the browser, and how many download it.</p>
          </div>
          <nav className="flex gap-2 text-sm" aria-label="Window">
            {APP_WINDOWS.map((w) => (
              <Link key={w} href={`/admin/apps?days=${w}`} aria-current={w === days ? "page" : undefined}
                className={`rounded-lg border px-3 py-1 ${w === days ? "border-cyan-300 text-cyan-200" : "border-white/15 text-white/70"}`}>
                {w}d
              </Link>
            ))}
          </nav>
        </div>
        {children}
      </div>
    </main>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-base font-bold">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-white/55">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function DailyChart({ rows }: { rows: DailyRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-white/50">Nothing in this window.</p>
  const present = APP_PLATFORMS.filter((p) => rows.some((r) => r.counts[p] > 0))
  const max = Math.max(1, ...rows.map((r) => present.reduce((s, p) => s + r.counts[p], 0)))
  const tick = new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])

  return (
    <div data-testid="admin-apps-daily">
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-white/70" aria-label="Legend">
        {present.map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR[p] }} />
            {APP_PLATFORM_LABEL[p]}
          </span>
        ))}
      </div>
      <div className="flex h-40 items-end gap-1 border-b border-white/15" role="img"
        aria-label={`People each day for ${rows.length} days, split by platform. A table version is below.`}>
        {rows.map((r) => {
          const total = present.reduce((s, p) => s + r.counts[p], 0)
          return (
            <div key={r.day} className="group flex h-full min-w-0 flex-1 flex-col-reverse gap-[2px]" title={`${shortDay(r.day)}: ${total.toLocaleString("en-US")} people`}>
              {present.filter((p) => r.counts[p] > 0).map((p, i, arr) => (
                <div key={p}
                  title={`${shortDay(r.day)} · ${APP_PLATFORM_LABEL[p]}: ${r.counts[p].toLocaleString("en-US")}`}
                  className={`w-full transition-opacity group-hover:opacity-90 ${i === arr.length - 1 ? "rounded-t" : ""}`}
                  style={{ height: `${(r.counts[p] / max) * 100}%`, background: COLOR[p] }} />
              ))}
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[11px] text-white/50">
        {rows.map((r, i) => (
          <div key={r.day} className="min-w-0 flex-1 text-center">{tick.has(i) ? shortDay(r.day) : ""}</div>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-white/60">Show as a table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs uppercase text-white/50">
            <tr><th className="py-1 pr-3">Day</th>{present.map((p) => <th key={p} className="py-1 pr-3">{APP_PLATFORM_LABEL[p]}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-t border-white/10">
                <td className="py-1 pr-3 text-white/70">{shortDay(r.day)}</td>
                {present.map((p) => <td key={p} className="py-1 pr-3">{r.counts[p].toLocaleString("en-US")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
