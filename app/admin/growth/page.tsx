import Link from "next/link"
import { redirect } from "next/navigation"

import { getAdminAccessState } from "@/lib/adminAuth"
import { GROWTH_WINDOWS, getGrowthRevenueReport, type GrowthRevenueReport } from "@/lib/admin-dashboard/GrowthRevenueService"
import { entrySourceLabel, formatDelta, formatRate, rateOf } from "@/lib/admin-dashboard/growthRevenue"
import { describeMrrEstimate, formatUsdCents } from "@/lib/monetization/mrrEstimate"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const metadata = { robots: { index: false, follow: false } }

const fmt = (n: number) => n.toLocaleString("en-US")

/**
 * Growth & revenue on one screen (owner's call 2026-11-15): the path a person takes — visit, sign up,
 * bring a league, leaguemates, free trial, paid — with where they drop off, which features sell the plan,
 * and whether the people who pay stay. Counting rules: lib/admin-dashboard/growthRevenue.ts.
 */
export default async function GrowthRevenuePage(props: { searchParams?: Promise<{ days?: string }> }) {
  const searchParams = await props.searchParams
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") redirect("/admin-login?next=/admin/growth")
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  let data: GrowthRevenueReport | null = null
  let fatal: string | null = null
  try {
    data = await getGrowthRevenueReport({ days: Number(searchParams?.days) })
  } catch (err) {
    fatal = err instanceof Error ? err.message : "Could not build the report"
  }
  const days = data?.days ?? 7

  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6" data-testid="admin-growth">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/admin" className="text-xs text-cyan-300/80">← Admin</Link>
            <h1 className="mt-1 text-2xl font-black">Growth &amp; revenue</h1>
            <p className="text-sm text-white/60">Where people come from, where they drop off, what makes them pay, and whether they stay.</p>
          </div>
          <nav className="flex gap-2 text-sm" aria-label="Window">
            {GROWTH_WINDOWS.map((w) => (
              <Link key={w} href={`/admin/growth?days=${w}`}
                className={`rounded-lg border px-3 py-1 ${w === days ? "border-cyan-300 text-cyan-200" : "border-white/15 text-white/70"}`}>
                {w}d
              </Link>
            ))}
          </nav>
        </div>

        {fatal || !data ? (
          <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{fatal ?? "No data."}</p>
        ) : (
          <>
            {data.errors.length ? (
              <ul className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" data-testid="admin-growth-errors">
                {data.errors.map((e) => <li key={e}>{e} — that section is left out rather than shown as zero.</li>)}
              </ul>
            ) : null}

            {data.growth ? (
              <Section
                title={`The path, last ${days} days`}
                hint={`People who did each thing in the window, compared with the ${days} days before. Not a cohort: someone who signed up earlier and paid this week counts in "Paid" only.${data.truncated ? " ⚠ The event read hit its limit, so these are a floor." : ""}`}
              >
                <ol className="flex flex-col gap-2" data-testid="admin-growth-funnel">
                  {data.growth.funnel.map((s) => {
                    const top = data!.growth!.funnel[0]!.count || Math.max(...data!.growth!.funnel.map((x) => x.count), 1)
                    const width = Math.max(2, Math.round((s.count / top) * 100))
                    return (
                      <li key={s.key} className="rounded-xl border border-white/10 bg-white/[0.04] p-3" data-stage={s.key}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-semibold">{s.label}</span>
                          <span className="tabular-nums">
                            <b className="text-lg">{fmt(s.count)}</b>
                            <span className="ml-2 text-xs text-white/55">{formatDelta(s.count, s.previous)} vs previous {days}d</span>
                          </span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-white/10" aria-hidden>
                          <div className="h-2 rounded-full bg-cyan-400/70" style={{ width: `${Math.min(100, width)}%` }} />
                        </div>
                        {s.fromPrevious !== null ? (
                          <p className="mt-1 text-xs text-white/55">{formatRate(s.fromPrevious)} of the step before</p>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {data.growth.side.map((f) => (
                    <div key={f.key} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                      <p className="text-xs text-white/55">{f.label}</p>
                      <p className="mt-1 text-xl font-bold tabular-nums">{fmt(f.count)}</p>
                      <p className="text-xs text-white/45">{formatDelta(f.count, f.previous)} vs previous</p>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            {data.growth ? (
              <Section title="What sells the plan" hint="Which surface sent people to checkout, and how many of them paid, this window. 'Not tagged yet' is a checkout from a surface that does not say where it came from.">
                <Table
                  head={["Where they came from", "Saw offer", "Clicked", "Started checkout", "Started a trial", "Paid", "Checkout → paid"]}
                  rows={data.growth.whatSells.map((r) => [entrySourceLabel(r.entrySource), fmt(r.viewed), fmt(r.clicked), fmt(r.checkouts), fmt(r.trials), fmt(r.paid), formatRate(rateOf(r.paid, r.checkouts))])}
                />
              </Section>
            ) : null}

            {data.growth ? (
              <Section title="Token pack sales" hint="Stripe checkout sessions and confirmed payments in this window. Repeat webhook deliveries count once.">
                <Table
                  head={["Where they came from", "Started checkout", "Paid"]}
                  rows={data.growth.tokenSales.map((r) => [entrySourceLabel(r.entrySource), fmt(r.checkouts), fmt(r.paid)])}
                />
              </Section>
            ) : null}

            <Section title="Revenue and keeping it" hint="MRR is now. The other figures are this window.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {data.mrr ? (
                  <Card label="MRR estimate" value={formatUsdCents(data.mrr.mrrCents)} note={describeMrrEstimate(data.mrr)} />
                ) : null}
                {data.retention ? (
                  <>
                    <Card label="Failed payments recovered" value={`${fmt(data.retention.recoveredInvoices)} of ${fmt(data.retention.failedInvoices)}`}
                      note={`${formatRate(rateOf(data.retention.recoveredInvoices, data.retention.failedInvoices))} of failed cards were fixed`} />
                    <Card label="Free trials that paid" value={`${fmt(data.retention.trialsConverted)} of ${fmt(data.retention.trialsStarted)}`}
                      note={`${formatRate(rateOf(data.retention.trialsConverted, data.retention.trialsStarted))} — a trial started late in the window may not have reached its first charge yet`} />
                    <Card label="Cancellations that came back" value={`${fmt(data.retention.cameBack)} of ${fmt(data.retention.cancellations)}`}
                      note={`${formatRate(rateOf(data.retention.cameBack, data.retention.cancellations))} restarted after cancelling`} />
                  </>
                ) : null}
                {data.proWeek ? (
                  <Card label="Referral weeks (30 days)" value={fmt(data.proWeek.granted30d)}
                    note={`${fmt(data.proWeek.friendsBroughtLeague30d)} referred friends brought a league · ${fmt(data.proWeek.convertedToPaid)} of ${fmt(data.proWeek.peopleWithWeek)} who had a week went on to pay`} />
                ) : null}
              </div>
            </Section>

            <p className="text-xs text-white/45">Generated {data.generatedAt.replace("T", " ").slice(0, 16)} UTC. Read-only.</p>
          </>
        )}
      </div>
    </main>
  )
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-xs text-white/55">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-white/50">{note}</p> : null}
    </div>
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
          <tr key={i} className="border-t border-white/10">
            {r.map((c, j) => <td key={j} className="py-1.5 pr-3">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
