/**
 * Dev-only preview of the Phase 6 trade-value breakdown.
 *
 * ⚠ WHY THIS EXISTS RATHER THAN JUST OPENING THE TRADE CENTER. The same two reasons as
 * `/dev/admin-29a-preview`, and the second is the important one:
 *   1. The trade console is behind auth, a league, and a roster selection.
 *   2. This checkout's `.env.local` points `DATABASE_URL` at the PRODUCTION Neon endpoint
 *      (`ep-curly-block-…`), which CLAUDE.md names explicitly. Opening a real league locally
 *      would run every roster and valuation query against production to look at a panel.
 *
 * So the panel is reviewed here against obviously-synthetic data, and the real screen keeps
 * computing everything from the engine. 404s outside development; nothing links to it.
 *
 * ⚠ EVERY NUMBER BELOW IS INVENTED AND THIS FILE IS UNREACHABLE IN PRODUCTION. If you are
 * copying a shape out of here into product code, you are about to ship a fabricated valuation.
 *
 * 🛑 AND IT MUST NEVER IMPORT PRISMA, DIRECTLY OR TRANSITIVELY. The whole point is a page that
 * cannot touch the production database. `TradeValueBreakdown` is a pure client component over
 * types; keep it that way.
 */

import { notFound } from 'next/navigation'
import { TradeValueBreakdown } from '@/components/trade-value/TradeValueBreakdown'
import type { AssetValueSnapshot, TradeValueSnapshot } from '@/lib/trade-value/types'

export const dynamic = 'force-dynamic'

const NO_SOURCES = {
  projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null,
}

const snapshot = (sides: [AssetValueSnapshot[], AssetValueSnapshot[]]): TradeValueSnapshot =>
  ({
    version: '1.0',
    context: {
      sport: 'NFL', leagueType: 'redraft', scoring: 'ppr',
      rosterFormat: 'standard', capturedAt: new Date('2026-09-02T12:00:00Z').toISOString(),
    },
    sides: [
      { rosterId: 'r1', total: sides[0].reduce((s, a) => s + a.internalValue, 0), assets: sides[0] },
      { rosterId: 'r2', total: sides[1].reduce((s, a) => s + a.internalValue, 0), assets: sides[1] },
    ],
    grade: { grade: 'B', fairnessScore: 71, confidenceScore: 64, valueDifference: 640, bullets: [] },
  }) as unknown as TradeValueSnapshot

/** Every basis the engine can report, so all four render paths are visible at once. */
const ORDINARY = snapshot([
  [
    {
      kind: 'player', fromRosterId: 'r1', toRosterId: 'r2',
      playerName: 'Perry Vance', position: 'WR', team: 'CIN',
      sources: { ...NO_SOURCES, projectionValue: 251 },
      internalValue: 6552, valuationBasis: 'projection', formatFit: null,
    },
    {
      kind: 'player', fromRosterId: 'r1', toRosterId: 'r2',
      playerName: 'Dana Okoye', position: 'LB', team: 'SEA',
      sources: { ...NO_SOURCES, idpValue: 3120 },
      internalValue: 3120, valuationBasis: 'idp', formatFit: null,
    },
  ],
  [
    {
      kind: 'player', fromRosterId: 'r2', toRosterId: 'r1',
      playerName: 'Marcus Feld', position: 'RB', team: 'DET',
      sources: { ...NO_SOURCES, fantasyCalcValue: 5400 },
      internalValue: 5400, valuationBasis: 'market', formatFit: null,
    },
    {
      kind: 'draft_pick', fromRosterId: 'r2', toRosterId: 'r1',
      pickSeason: 2027, pickRound: 2, pickLabel: '2027 2nd',
      sources: NO_SOURCES, internalValue: 1832, valuationBasis: null, formatFit: null,
    },
    {
      kind: 'faab', fromRosterId: 'r2', toRosterId: 'r1', faabAmount: 18,
      sources: NO_SOURCES, internalValue: 180, valuationBasis: null, formatFit: null,
    },
  ],
])

/** The two cases that were previously invisible: an unpriced player, and a format opinion. */
const EDGE = snapshot([
  [
    {
      kind: 'player', fromRosterId: 'r1', toRosterId: 'r2',
      playerName: 'Elliot Rourke', position: 'TE', team: 'ARI',
      sources: NO_SOURCES, internalValue: 0, valuationBasis: 'none', formatFit: null,
    },
    {
      kind: 'player', fromRosterId: 'r1', toRosterId: 'r2',
      playerName: 'Sunny Adebayo', position: 'WR', team: 'LV',
      sources: { ...NO_SOURCES, projectionValue: 240 },
      internalValue: 6288, valuationBasis: 'projection',
      formatFit: {
        formatId: 'four_horsemen', label: 'Four Horsemen',
        fit: { multiplier: 1.05, reason: 'Taxi-eligible on a 10-slot taxi squad, so holding him costs this roster nothing.' },
        legality: { ok: true },
      },
    },
  ],
  [
    {
      kind: 'player', fromRosterId: 'r2', toRosterId: 'r1',
      playerName: 'Wes Carrow', position: 'QB', team: 'HOU',
      sources: { ...NO_SOURCES, projectionValue: 310 },
      internalValue: 7410, valuationBasis: 'projection',
      formatFit: {
        formatId: 'guillotine', label: 'Guillotine',
        fit: { multiplier: 0.53, reason: '10 of 18 teams left. Assuming an even chance of being chopped, you can expect about 4.5 more weeks — so a trade is worth roughly 53% of what the same trade was worth in week one.' },
        legality: { ok: false, reason: 'Trades closed after week 11. There is no offseason here — the format ends with one team standing, so this does not reopen.' },
      },
    },
  ],
])

function Panel({ title, note, snap }: { title: string; note: string; snap: TradeValueSnapshot }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <h2 className="text-[13px] font-semibold text-white">{title}</h2>
      <p className="mb-2 mt-0.5 text-[11px] text-white/45">{note}</p>
      <TradeValueBreakdown snapshot={snap} sideNames={{ r1: 'Casey', r2: 'Jordan' }} />
    </section>
  )
}

export default function TradeValuePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="mx-auto max-w-3xl space-y-4 bg-[#0b0b0f] p-5 text-white">
      <header>
        <h1 className="text-[16px] font-bold">Trade value — the derivation panel</h1>
        <p className="mt-1 text-[11px] text-amber-200/80">
          ⚠ Dev-only. Every player, number and team below is invented — this page never queries a database.
        </p>
      </header>

      <Panel
        title="Ordinary trade — all four bases"
        note="Projection, IDP scarcity, market fallback, plus a pick and FAAB. Each row says which input produced its number."
        snap={ORDINARY}
      />

      <Panel
        title="The two cases that used to be invisible"
        note="An unpriced player rendering as a sentence rather than a bare zero, and two format models stating their opinion as a separate figure that never touches the base."
        snap={EDGE}
      />
    </main>
  )
}
