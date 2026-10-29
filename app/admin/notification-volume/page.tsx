import Link from "next/link"
import { redirect } from "next/navigation"

import { getAdminAccessState } from "@/lib/adminAuth"
import { getNotificationVolume, type NotificationVolume } from "@/lib/admin-dashboard/NotificationVolumeService"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const metadata = { robots: { index: false, follow: false } }

const WINDOWS = [1, 7, 14, 30]
const fmt = (n: number) => n.toLocaleString("en-US")

/**
 * How much we actually send. Built after users complained about too many pushes and emails: the
 * per-person numbers are the ones to watch — a healthy day is a handful, and "20+ a day" is the row
 * that predicts mutes and unsubscribes.
 */
export default async function NotificationVolumePage(props: { searchParams?: Promise<{ days?: string }> }) {
  const searchParams = await props.searchParams
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") redirect("/admin-login?next=/admin/notification-volume")
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  const days = WINDOWS.includes(Number(searchParams?.days)) ? Number(searchParams?.days) : 7
  let data: NotificationVolume | null = null
  let error: string | null = null
  try {
    data = await getNotificationVolume({ days })
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not read notification volume"
  }

  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6" data-testid="admin-notification-volume">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/admin" className="text-xs text-cyan-300/80">← Admin</Link>
            <h1 className="mt-1 text-2xl font-black">Notification volume</h1>
            <p className="text-sm text-white/60">What we actually sent — pushes, emails and texts — per day, per category and per person.</p>
          </div>
          <nav className="flex gap-2 text-sm">
            {WINDOWS.map((w) => (
              <Link key={w} href={`/admin/notification-volume?days=${w}`}
                className={`rounded-lg border px-3 py-1 ${w === days ? "border-cyan-300 text-cyan-200" : "border-white/15 text-white/70"}`}>
                {w === 1 ? "24h" : `${w}d`}
              </Link>
            ))}
          </nav>
        </div>

        {error || !data ? (
          <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error ?? "No data."}</p>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Pushes", data.totals.push],
                ["Emails", data.totals.email],
                ["Texts", data.totals.sms],
                ["In-app (bell)", data.totals.inApp],
                ["Pushes held by budget", data.totals.heldPush],
                ["People reached", data.totals.recipients],
                ["Failed deliveries", data.totals.failed],
                ["Master switch off", data.optOuts.masterSwitchOff],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs text-white/55">{label}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">{fmt(value as number)}</p>
                </div>
              ))}
            </section>

            <Section title="Per person per day" hint="One row per channel. A user-day is one person on one day they got at least one. Watch the 90th percentile and the 20+ count.">
              <Table head={["Channel", "User-days", "Average", "Median", "90th pct", "Most", "Days with 20+"]}
                rows={data.perUser.map((r) => [r.channel, fmt(r.userDays), r.avg, r.p50, r.p90, fmt(r.max), fmt(r.over20)])} />
            </Section>

            <Section title="By day">
              <Table head={["Day (UTC)", "Pushes", "Emails", "Texts", "In-app", "Held pushes"]}
                rows={data.daily.map((d) => [d.day, fmt(d.push), fmt(d.email), fmt(d.sms), fmt(d.inApp), fmt(d.heldPush)])} />
            </Section>

            <Section title="By category" hint="The settings category each send belonged to.">
              <Table head={["Category", "Pushes", "Emails", "Texts", "People"]}
                rows={data.categories.map((c) => [c.category, fmt(c.push), fmt(c.email), fmt(c.sms), fmt(c.users)])} />
            </Section>

            <Section title="Top notification types" hint="The 30 biggest type and channel pairs in the window.">
              <Table head={["Type", "Channel", "Sent", "People"]} rows={data.types.map((t) => [t.type, t.channel, fmt(t.sent), fmt(t.users)])} />
            </Section>

            <Section title="Most-notified people, last 24 hours" hint="Who is getting the most right now — open their settings before they mute us.">
              <Table head={["User", "Pushes", "Emails", "Texts", "Total"]}
                rows={data.topUsers.map((u) => [u.email ?? u.userId, fmt(u.push), fmt(u.email_), fmt(u.sms), fmt(u.total)])} />
            </Section>

            <Section title="Opt-outs">
              <Table head={["Measure", "Count"]} rows={[
                ["Profiles", fmt(data.optOuts.profiles)],
                ["Master notification switch off", fmt(data.optOuts.masterSwitchOff)],
                ["Email unsubscribed, all time", fmt(data.optOuts.emailUnsubscribedTotal)],
                [`Email unsubscribed, last ${data.days}d`, fmt(data.optOuts.emailUnsubscribedInWindow)],
                ["Texts stopped (SMS consent revoked)", fmt(data.optOuts.smsConsentRevoked)],
                ...Object.entries(data.optOuts.liveLevels).sort().map(([level, c]) => [`Live alert level: ${level}`, fmt(c)]),
              ]} />
            </Section>
            <p className="text-xs text-white/45">Texts were not logged before 2026-10-22, so windows reaching past that undercount them. Since {data.since.slice(0, 10)}.</p>
          </>
        )}
      </div>
    </main>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-base font-bold">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-white/55">{hint}</p> : null}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  if (rows.length === 0) return <p className="text-sm text-white/50">Nothing in this window.</p>
  return (
    <table className="w-full min-w-[480px] text-left text-sm">
      <thead className="text-xs uppercase text-white/50">
        <tr>{head.map((h) => <th key={h} className="py-1 pr-3 font-semibold">{h}</th>)}</tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-white/5">{r.map((c, j) => <td key={j} className="py-1.5 pr-3">{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}
