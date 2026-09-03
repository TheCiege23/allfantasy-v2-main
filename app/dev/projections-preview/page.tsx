/**
 * Dev-only preview of the Phase 6.1 projection row.
 *
 * ⚠ Same reason as `/dev/trade-value-preview` and `/dev/admin-29a-preview`: `/projections` needs a
 * session, and this checkout's `.env.local` points `DATABASE_URL` at the PRODUCTION Neon endpoint,
 * so rendering the real page locally would run projection queries against production to look at a
 * row layout.
 *
 * ⚠ EVERY NUMBER BELOW IS INVENTED AND THIS FILE IS UNREACHABLE IN PRODUCTION.
 *
 * 🛑 IT MUST NEVER IMPORT PRISMA, DIRECTLY OR TRANSITIVELY. `AfProjectionRow` is a pure client
 * component over a view type; keep it that way.
 *
 * 🛑 BUT THE PAGE NOT QUERYING IS NOT THE SAME AS THE PAGE VIEW NOT QUERYING, AND AN EARLIER
 * VERSION OF THIS COMMENT GOT THAT WRONG. The app layout wraps every route, and on load it calls
 * `/api/user/profile` and `/api/user/time-context`, both of which run `ensureUserProfileForUserId`
 * — prisma — as soon as there IS a session. Observed here: those returned 200, not 401, so they
 * reached the database this checkout points at, which is production.
 *
 * ⚠ AND "NO PRISMA LINES IN THE SERVER LOG" PROVES NOTHING. `lib/prisma.ts` logs
 * `["warn","error"]` in development, never `"query"` — a successful query prints nothing at all.
 * Reading that silence as "no queries ran" is a check that cannot fail.
 *
 * A page view here also fires a Meta CAPI PageView from the layout. Harmless for one dev load,
 * worth knowing before anyone loops over these pages.
 */

import { notFound } from 'next/navigation'
import { AfProjectionRow, type AfProjectionView } from '@/components/projections/AfProjectionRow'

export const dynamic = 'force-dynamic'

const p = (over: Partial<AfProjectionView>): AfProjectionView => ({
  playerId: 'x',
  playerName: 'Player',
  position: 'RB',
  week: null,
  perGame: 12,
  baseline: 12,
  weatherAdjustment: 0,
  restOfSeason: null,
  restOfSeasonWeeks: null,
  confidence: 'medium',
  reason: null,
  isOutdoorGame: true,
  computedAt: '2026-09-02T07:53:00.000Z',
  ...over,
})

const ROWS: AfProjectionView[] = [
  p({
    playerId: '1', playerName: 'Perry Vance', position: 'WR', week: 3,
    perGame: 18.4, baseline: 17.9, weatherAdjustment: 0.5,
    restOfSeason: 257.6, restOfSeasonWeeks: 14, confidence: 'high',
  }),
  p({
    playerId: '2', playerName: 'Marcus Feld', position: 'RB', week: 3,
    perGame: 13.1, baseline: 15.4, weatherAdjustment: -2.3,
    restOfSeason: 183.4, restOfSeasonWeeks: 14, confidence: 'medium',
    reason: 'Sustained wind above 18mph and rain at kickoff; rushing volume up, receiving down.',
  }),
  p({
    playerId: '3', playerName: 'Wes Carrow', position: 'QB', week: 3,
    perGame: 21.8, baseline: 21.8, weatherAdjustment: 0,
    restOfSeason: 305.2, restOfSeasonWeeks: 14, confidence: 'high',
    isOutdoorGame: false,
  }),
  // 🛑 The case the whole rule exists for: no rest-of-season computed. Must render as a dash.
  p({
    playerId: '4', playerName: 'Elliot Rourke', position: 'TE',
    perGame: 6.2, baseline: 6.2, weatherAdjustment: 0,
    restOfSeason: null, restOfSeasonWeeks: null, confidence: 'low',
  }),
  // A genuine zero — a different claim from the row above, and it must look different.
  p({
    playerId: '5', playerName: 'Dana Okoye', position: 'K', week: 3,
    perGame: 0, baseline: 0, weatherAdjustment: 0,
    restOfSeason: 0, restOfSeasonWeeks: 14, confidence: 'low',
    reason: 'Ruled out for the season; no remaining games projected.',
  }),
]

export default function ProjectionsPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="mx-auto max-w-2xl space-y-4 bg-[#0b0b0f] p-5 text-white">
      <header>
        <h1 className="text-[16px] font-bold">Projections — the AF engine row</h1>
        <p className="mt-1 text-[11px] text-amber-200/80">
          ⚠ Dev-only. Every player and number below is invented. This page runs no query of its own —
          though the surrounding app layout still calls profile and session endpoints that do.
        </p>
      </header>

      <div className="mb-2 flex items-center gap-2 px-1 text-[9px] font-bold uppercase tracking-wide text-white/20">
        <span className="flex-1">Player <span className="normal-case text-white/25">2025 season</span></span>
        <span className="w-16 text-right">Per game</span>
        <span className="w-20 text-right">Rest of season</span>
      </div>
      <ul className="space-y-1">
        {ROWS.map((row) => (
          <AfProjectionRow key={row.playerId} p={row} />
        ))}
      </ul>

      <p className="text-[10px] text-white/35">
        Row 4 has no rest-of-season computed and shows a dash. Row 5 is a real zero. Those are
        different claims and the whole point of this phase is that they no longer look the same.
      </p>
    </main>
  )
}
