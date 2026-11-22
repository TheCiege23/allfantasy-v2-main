import Link from "next/link"
import { redirect } from "next/navigation"

import { getAdminAccessState } from "@/lib/adminAuth"
import { prisma } from "@/lib/prisma"
import { LEARNED_STALE_DAYS, loadLearnedMarketReport, type LearnedMarketReport, type ReportRow, type ReportSection } from "@/lib/trade-market/learnedMarketReport"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const metadata = { robots: { index: false, follow: false } }

/**
 * The learned trade market (owner's call 2026-11-22): what the daily run measured from completed trades — pick values,
 * contend/rebuild premiums, need premiums — how much evidence each number rests on, whether it is published, and the
 * line a grade prints for it. Rules: lib/trade-market/learnedMarketReport.ts. Read-only.
 */
export default async function TradeMarketPage() {
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") redirect("/admin-login?next=/admin/trade-market")
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  let data: LearnedMarketReport | null = null
  let fatal: string | null = null
  try {
    data = await loadLearnedMarketReport(prisma)
  } catch (err) {
    fatal = err instanceof Error ? err.message : "Could not read the learned tables"
  }

  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6" data-testid="admin-trade-market">
        <div>
          <Link href="/admin" className="text-xs text-cyan-300/80">← Admin</Link>
          <h1 className="mt-1 text-2xl font-black">Learned trade market</h1>
          <p className="text-sm text-white/60">
            What completed trades say picks, contending and roster holes are worth — measured daily, and the exact line a
            grade shows for each. Only <b>published</b> numbers from a table under {LEARNED_STALE_DAYS} days old ever reach a grade.
          </p>
        </div>

        {fatal || !data ? (
          <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{fatal ?? "No data."}</p>
        ) : (
          <>
            <p className="text-sm text-white/70" data-testid="admin-trade-market-summary">
              {data.publishedRows} of {data.totalRows} measured numbers are published.
            </p>
            <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70" data-testid="admin-trade-market-holdout">
              <span className="font-semibold text-white">Checked on later trades: </span>
              {data.holdout.status.missing
                ? "not run yet. Until it runs, the publish thresholds alone decide what a grade uses."
                : `last run ${data.holdout.status.generatedAt?.slice(0, 16).replace("T", " ")} UTC${data.holdout.cutoff ? `, testing on trades from ${data.holdout.cutoff.slice(0, 10)} on` : ""}. A number that made grades worse on those trades is ignored until it holds again.`}{" "}
              {data.holdout.releasedToPartners
                ? "The partner page shows the trade market panel."
                : "The partner page keeps the trade market panel hidden until more of these hold than fail."}
            </p>
            {data.sections.map((s) => <SectionView key={s.key} section={s} />)}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" data-section="other-sports">
              <h2 className="text-base font-bold">Other sports — NBA, MLB, NHL, NCAAB, soccer</h2>
              <p className="mt-0.5 text-xs text-white/55">
                Measured only, not used by any grade yet. These sports have no dated market, so learning starts from trades
                captured since their board values began being saved with each trade (2026-11-22).
              </p>
              <p className="mt-1 text-xs text-white/55" data-testid="status-other-sports">
                {data.otherSports.status.missing
                  ? "Not written yet — the daily market run has not stored this table."
                  : `Written ${data.otherSports.status.generatedAt?.slice(0, 16).replace("T", " ")} UTC (${data.otherSports.status.ageDays} days ago).`}
              </p>
              {data.otherSports.sports.map((sp) => (
                <div key={sp.sport} className="mt-4" data-sport={sp.sport}>
                  <h3 className="text-sm font-semibold">
                    {sp.sport}
                    <span className="ml-2 font-normal text-white/50">{sp.tradesRead.toLocaleString("en-US")} trades with board values</span>
                  </h3>
                  <ul className="mt-1 text-sm">
                    {sp.rows.map((r) => (
                      <li key={r.label} className="border-t border-white/5 py-1.5">
                        {r.label}: <span className="tabular-nums">{r.pct == null ? "—" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}</span>
                        <span className="ml-2 text-xs text-white/55">
                          {r.trades} trades · {r.published ? "enough to state" : "not enough yet"} · {r.note}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  )
}

function SectionView({ section: s }: { section: ReportSection }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" data-section={s.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">{s.title}</h2>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${s.switch.on ? "border-emerald-300/50 text-emerald-200" : "border-white/20 text-white/60"}`}
          data-testid={`switch-${s.key}`}
        >
          {s.switch.env} {s.switch.on ? "on" : "off"} on this service
        </span>
      </div>
      <p className="mt-0.5 text-xs text-white/55">When on, it {s.switch.what}.</p>
      <p className="mt-1 text-xs text-white/55" data-testid={`status-${s.key}`}>
        {s.status.missing
          ? "Not written yet — the daily market run has not stored this table."
          : `Written ${s.status.generatedAt?.slice(0, 16).replace("T", " ")} UTC (${s.status.ageDays} days ago).`}
        {s.status.stale ? ` ⚠ Older than ${LEARNED_STALE_DAYS} days, so grades ignore it until the daily run writes again.` : ""}
      </p>

      {s.books.length === 0 ? (
        <p className="mt-3 text-sm text-white/50">No books measured.</p>
      ) : (
        s.books.map((b) => (
          <div key={b.book} className="mt-4" data-book={b.book}>
            <h3 className="text-sm font-semibold">
              {b.label}
              {b.tradesUsed != null ? <span className="ml-2 font-normal text-white/50">{b.tradesUsed.toLocaleString("en-US")} observations</span> : null}
            </h3>
            {b.holdout ? (
              <p
                className={`mt-1 rounded-lg border p-2 text-xs ${b.holdout.verdict === "not_held" ? "border-rose-400/40 bg-rose-400/10 text-rose-100" : b.holdout.verdict === "held" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-white/15 bg-white/5 text-white/65"}`}
                data-testid={`holdout-${s.key}-${b.book}`}
                data-verdict={b.holdout.verdict}
              >
                <span className="font-semibold">Checked on later trades. </span>
                {b.holdout.says}
              </p>
            ) : null}
            {b.warnings.map((w) => (
              <p key={w} className="mt-1 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">{w}</p>
            ))}
            {/* Stacked on a phone, columns from sm up — a wide table hid "what a grade says" off-screen (seen 2026-11-22). */}
            <div className="mt-2 text-sm">
              <div className={`hidden text-xs uppercase text-white/50 sm:grid ${ROW_GRID}`}>
                <span className="py-1 font-semibold">What</span>
                <span className="py-1 font-semibold">Move</span>
                <span className="py-1 font-semibold">Evidence</span>
                <span className="py-1 font-semibold">Status</span>
                <span className="py-1 font-semibold">What a grade says</span>
              </div>
              {b.rows.map((r) => <RowView key={r.label} row={r} />)}
            </div>
          </div>
        ))
      )}
    </section>
  )
}

const ROW_GRID = "sm:grid-cols-[1.3fr_0.5fr_0.8fr_1.3fr_1.7fr] sm:gap-3"

function RowView({ row: r }: { row: ReportRow }) {
  const move = r.pct == null ? "—" : `${r.pct > 0 ? "+" : ""}${r.pct}%`
  return (
    <div className={`grid gap-1 border-t border-white/5 py-2 ${ROW_GRID}`} data-published={r.published ? "yes" : "no"}>
      <div>
        <span className="font-medium">{r.label}</span>
        <span className="ml-2 tabular-nums sm:hidden">{move}</span>
        <div className="text-xs text-white/45">{r.detail}</div>
      </div>
      <div className="hidden tabular-nums sm:block">{move}</div>
      <div className="text-xs text-white/70">
        {r.trades.toLocaleString("en-US")} trades <span className="text-white/45">· effective {r.effectiveSample}</span>
      </div>
      <div className="text-xs">
        {r.published ? <span className="text-emerald-200">Published</span> : <span className="text-white/55">Not yet</span>}
        <span className="text-white/45"> · {r.note}</span>
      </div>
      <div className="text-xs text-white/75">
        <span className="text-white/45 sm:hidden">A grade says: </span>
        {r.gradeSays ?? <span className="text-white/40">Nothing — the grade uses its usual value.</span>}
      </div>
    </div>
  )
}
