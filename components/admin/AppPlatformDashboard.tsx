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

/**
 * /admin/apps — the view only (data: lib/admin-dashboard/AppPlatformStatsService.ts).
 * Series colours: categorical slots 1–3 (dark steps), validated against this page's
 * #020817 surface; "Not labelled yet" is a neutral grey, never a fourth hue.
 */
const COLOR: Record<AppPlatformKey, string> = {
  ios_app: "#3987e5",
  android_app: "#d95926",
  web: "#199e70",
  unlabelled: "#64748b",
}

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"))

const STORE_LINKS = [
  { label: "App Store Connect → Analytics", href: "https://appstoreconnect.apple.com/analytics" },
  { label: "Google Play Console → Statistics", href: "https://play.google.com/console" },
]

export function AppPlatformDashboard({ report }: { report: AppPlatformReport }) {
  const { days } = report
  const hasUnlabelled = report.platforms.some((p) => p.platform === "unlabelled")
  const errors = [...new Set(report.errors)]

  return (
    <Frame days={days}>
      {errors.length ? (
        <ul className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" data-testid="admin-apps-errors">
          {errors.map((e) => <li key={e}>{e} — that part is left out rather than shown as zero.</li>)}
        </ul>
      ) : null}

      <p className="text-3xl font-black" data-testid="admin-apps-headline">
        {fmt(report.totalActive)} <span className="text-lg font-semibold text-white/70">people used AllFantasy in the last {days} days</span>
      </p>

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

      {hasUnlabelled ? (
        <p className="text-xs text-white/55">
          Some visits are from before the app label went live (Nov 20, 2026), so they can&apos;t be split by platform. They show as grey below and fade out of the window on their own.
        </p>
      ) : null}

      <Section title="People each day" hint="One bar per day. Hover a segment for its number.">
        {report.daily ? <DailyChart rows={report.daily} /> : <p className="text-sm text-white/50">The daily chart couldn&apos;t load.</p>}
      </Section>

      <Section title="Downloads" hint="Download counts come from the stores themselves and update about once a day.">
        <div className="flex flex-wrap gap-2">
          {STORE_LINKS.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
              className="rounded-xl border border-cyan-300/30 px-3 py-2 text-sm font-semibold text-cyan-100">
              {l.label} ↗
            </a>
          ))}
        </div>
      </Section>

      <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/65">
        <summary className="cursor-pointer font-semibold text-white/80">How these are counted</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Active</b>: people who opened a page in the window. Someone who used two platforms counts on both, so the cards can add up to more than the headline.</li>
          <li><b>New</b>: first seen in the window, with no visit in the {NEW_USER_LOOKBACK_DAYS} days before. Counted on the platform they arrived on.</li>
          <li><b>Came back</b>: of those new people, the share who returned on a later day. Recent arrivals have had less time, so it reads low for short windows.</li>
          <li>Counts come from PostHog. Visitors who block analytics aren&apos;t counted.</li>
        </ul>
      </details>
    </Frame>
  )
}

export function AppPlatformSetup() {
  return (
    <Frame days={null}>
      <Section title="Connect PostHog to turn this on" hint="One-time setup, about 5 minutes. The key is read-only.">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-white/80" data-testid="admin-apps-setup">
          <li>In PostHog, open <b>Settings → Personal API keys</b> and create a key with only the <b>Query: read</b> scope, limited to the AllFantasy project.</li>
          <li>Copy the project ID — the number in the PostHog address bar after <code>/project/</code>.</li>
          <li>In Railway, on the <b>allfantasy-v2-main</b> service, add <code>POSTHOG_PERSONAL_API_KEY</code> and <code>POSTHOG_PROJECT_ID</code>. Saving redeploys the site (~20 min).</li>
        </ol>
      </Section>
    </Frame>
  )
}

function Frame({ days, children }: { days: number | null; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8 sm:px-6" data-testid="admin-apps">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/admin" className="text-xs text-cyan-300/80">← Admin</Link>
            <h1 className="mt-1 text-2xl font-black">Apps</h1>
            <p className="text-sm text-white/60">Who uses AllFantasy in the iOS app, the Android app and the browser.</p>
          </div>
          {days != null ? (
            <nav className="flex gap-2 text-sm" aria-label="Window">
              {APP_WINDOWS.map((w) => (
                <Link key={w} href={`/admin/apps?days=${w}`} aria-current={w === days ? "page" : undefined}
                  className={`rounded-lg border px-3 py-1 ${w === days ? "border-cyan-300 text-cyan-200" : "border-white/15 text-white/70"}`}>
                  {w}d
                </Link>
              ))}
            </nav>
          ) : null}
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
