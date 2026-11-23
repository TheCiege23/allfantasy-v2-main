import { Card } from '@/components/partners/PartnerSections'
import { VIZ } from '@/components/partners/vizTokens'
import type { AdpMoverRow, LiveIntelligence } from '@/lib/partner-portal/liveIntelligence'

/**
 * The partner pages' live panels (lib/partner-portal/liveIntelligence.ts). Server-rendered, no client state.
 *
 * Projection accuracy is a paired bar per sport: the plain trailing average's average miss in gray, AF's in the first
 * series hue, on one shared scale — shorter is better, and the "closer by" figure is printed in text beside it, so the
 * comparison never rests on colour or length alone. The graded record carries its verdict as a word. A panel with
 * nothing measured yet says so in one line rather than drawing an empty chart.
 */

const TONE_WORD: Record<string, string> = { held: 'Held up', not_held: 'Has not held up', even: 'No direction' }
const TONE_DOT: Record<string, string> = { held: VIZ.status.good, not_held: VIZ.status.critical, even: VIZ.neutral }

function Measuring({ what }: { what: string }) {
  return <p className="text-sm text-white/55">{what}</p>
}

function Movers({ title, rows, up }: { title: string; rows: AdpMoverRow[]; up: boolean }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">{title}</h3>
      {rows.length === 0 ? (
        <Measuring what="No player has moved enough this week to show." />
      ) : (
        <ul className="divide-y divide-white/5 rounded-xl border border-white/10">
          {rows.map((r) => (
            <li key={`${r.sport}:${r.playerName}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="text-sm text-white/90">{r.playerName}</span>
              <span className="text-[11px] text-white/45">{r.sport} · {r.context}</span>
              <span className="ml-auto text-xs text-white/60">
                <span className="text-sm font-semibold tabular-nums text-white">
                  {up ? '▲' : '▼'} {Math.abs(r.movedPicks).toFixed(1)}
                </span>{' '}
                picks {up ? 'earlier' : 'later'} · ADP {r.adp.toFixed(1)} · {r.drafts.toLocaleString('en-US')} drafts
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function LiveIntelligencePanels({ data }: { data: LiveIntelligence }) {
  const scale = Math.max(1, ...data.projections.map((p) => Math.max(p.plainMae, p.afMae)))
  return (
    <>
      <Card
        id="live-record"
        title="Every call, checked against what happened"
        subtitle={`Live, not sample data${data.recordSeason ? ` — ${data.recordSeason} season` : ''}. Start/sit swaps, pickups and trade grades in every sport and league type, graded after the games are played. Misses stay in.`}
      >
        {data.record.length === 0 ? (
          <Measuring what="Grading is under way; a line appears here once enough calls are graded to state a rate." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.record.map((l) => (
              <li key={l.key} className="rounded-xl border border-white/10 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">{l.title}</p>
                <p className="mt-1 text-sm font-semibold text-white">{l.headline}</p>
                <p className="mt-1 text-xs text-white/55">{l.detail}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-white/70">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: TONE_DOT[l.tone] ?? VIZ.neutral }} aria-hidden />
                  {TONE_WORD[l.tone] ?? ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        id="live-projections"
        title="How close the projections land"
        subtitle="Live. Each sport's factors are learned on older games and checked on the newest quarter, which they never saw: the average miss of the plain trailing average against AllFantasy's projection. A factor is used only if it made those later games closer."
      >
        {data.projections.length === 0 ? (
          <Measuring what="The first check runs once a sport has enough stored games." />
        ) : (
          <div>
            <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/65" aria-label="Legend">
              <li className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: VIZ.neutral }} aria-hidden />
                Plain trailing average
              </li>
              <li className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: VIZ.series1 }} aria-hidden />
                AllFantasy projection
              </li>
            </ul>
            <ul className="space-y-4">
              {data.projections.map((p) => (
                <li key={p.sport}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span className="font-semibold text-white">{p.sport}</span>
                    <span className="text-xs text-white/55">
                      <span className="text-sm font-semibold tabular-nums text-white">
                        {p.closerPct >= 0 ? `${p.closerPct}% closer` : `${Math.abs(p.closerPct)}% further`}
                      </span>{' '}
                      · {p.games.toLocaleString('en-US')} later games
                    </span>
                  </div>
                  {(
                    [
                      ['Plain', p.plainMae, VIZ.neutral],
                      ['AllFantasy', p.afMae, VIZ.series1],
                    ] as const
                  ).map(([label, v, color]) => (
                    <div key={label} className="mb-[2px] flex items-center gap-2">
                      <span className="w-20 shrink-0 text-[11px] text-white/50">{label}</span>
                      <span className="h-2.5 flex-1 rounded-r" style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <span className="block h-2.5 rounded-r" style={{ width: `${(v / scale) * 100}%`, background: color }} />
                      </span>
                      <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-white/70">{v.toFixed(2)} pts off</span>
                    </div>
                  ))}
                  {p.factors.length ? <p className="mt-1 text-xs text-white/50">Used: {p.factors.join('; ')}.</p> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card
        id="live-adp"
        title="Where players are actually being drafted"
        subtitle="Live AF ADP, updated daily from real drafts and weighted toward the most recent ones — the biggest moves this week."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Movers title="Rising — going earlier" rows={data.adpRisers} up />
          <Movers title="Falling — going later" rows={data.adpFallers} up={false} />
        </div>
      </Card>
    </>
  )
}
