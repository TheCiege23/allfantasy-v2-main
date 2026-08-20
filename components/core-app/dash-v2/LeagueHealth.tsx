import type { SectionState } from '@/lib/core-app/leagueHome'
import type { HealthReading } from '@/lib/core-app/todayStrip'

/**
 * League health — a score, or an explicit statement that there is no score.
 *
 * ⚠ THIS TILE RENDERS ITS UNKNOWN STATE RATHER THAN HIDING, WHICH IS THE
 * OPPOSITE OF THE RECORD TILE NEXT TO IT. The two are not inconsistent: a record
 * is a scoreboard and an absent scoreboard says "nothing has been played", which
 * is true. Health is a judgement about a league that exists either way, so an
 * absent health tile would let the reader supply the missing word themselves —
 * and the word people supply is "fine".
 *
 * ⚠ THE UNKNOWN STATE IS THE ONE THAT ACTUALLY SHIPS TODAY. `lastSyncedAt` is
 * null on all 98 production leagues, so every reader currently sees this branch.
 * It is built as a designed state, not a fallback: an em-dash where the score
 * goes, the word UNKNOWN where the status goes, and the reason underneath in the
 * same shape as a real reading, so the tile keeps its size and the strip does
 * not reflow when a score eventually arrives.
 *
 * The specific failure being avoided: the engine happily returns "57" and
 * "DRIFTING" at `dataConfidence: 'high'` for a league nobody has ever read,
 * because its confidence check is "are there roster rows" and the activity
 * metrics that drag the score down are all legitimately zero on an unsynced
 * league. That is not a low-confidence measurement, it is a measurement of
 * nothing — see the gate in lib/core-app/todayStrip.ts.
 */
export function LeagueHealth({ state }: { state: SectionState<HealthReading> }) {
  if (!state.available) {
    return (
      <div className="af-d2-card af-d2-stat is-unknown">
        <p className="af-d2-stat-label">Health</p>
        <p className="af-d2-stat-value af-num is-unknown" aria-hidden>
          —
        </p>
        <p className="af-d2-stat-status is-unknown">Unknown</p>
        <p className="af-d2-stat-why">{state.reason}</p>
      </div>
    )
  }

  const { score, label, leaguesCounted } = state.data

  return (
    <div className="af-d2-card af-d2-stat">
      <p className="af-d2-stat-label">Health</p>
      <p className="af-d2-stat-value af-num">{score}</p>
      <p className="af-d2-stat-status">{label.toUpperCase()}</p>
      {/*
        How many leagues the average covers. A single number over an unstated
        denominator is how "57" ends up sounding like a fact about the account
        rather than about the two leagues it could actually be computed for.
      */}
      <p className="af-d2-stat-sub">
        Across {leaguesCounted} {leaguesCounted === 1 ? 'league' : 'leagues'}
      </p>
    </div>
  )
}

export default LeagueHealth
