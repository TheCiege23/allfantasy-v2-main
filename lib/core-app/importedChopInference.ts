import { choppedBefore } from './railMatchups'

/**
 * Which imported elimination leagues have already chopped YOUR team — inferred from the weekly scores,
 * because nothing else on file says so.
 *
 * 🛑 WHY THIS EXISTS (user report, 2026-11-08). An ESPN "Knockout" league kept putting its injured
 * starters in Home's Top decisions and Starters in doubt for a team ESPN had knocked out in week 8 —
 * and kept doing it after the league was confirmed Guilly. Home (`dash34.ts`) only knew three signals:
 * the provider flagged the roster, an elimination row was recorded, or a guillotine roster had been
 * emptied. An imported Guilly league writes none of them (lib/guillotine/importedGuillyHealth.ts:
 * "nothing records a chop for it — no chop row, no eliminated flag"), and the stored roster still
 * listed the players, so the team read as alive and its lineup as broken.
 *
 * The rail had answered this all along, with `choppedBefore` (railMatchups.ts) over the same
 * `WeeklyMatchup` rows — verified on production before it was written, 18 of 18 chops. This applies
 * that one rule to the one roster that is yours, rather than a second opinion about who is out.
 *
 * ⚠ ONLY WITH THE PROVIDER'S OWN STATED WEEK. `choppedBefore` treats every week before the current one
 * as finished and chops its lowest scorer; a guessed week that ran one ahead would chop someone on a
 * half-played Sunday and hide a real alert from a team that is alive. No stated week, no inference.
 *
 * Pure. The caller reads the rows.
 */
export type ChopCandidate = {
  /** Our league id. */
  leagueId: string
  /** The provider's league id — what `WeeklyMatchup.leagueId` holds. */
  platformLeagueId: string
  seasonYear: number
  /** The provider's stated current week (`leagueWeekFromSettings`). */
  currentWeek: number
  /** Your roster's id in the provider's numbering (`LeagueTeam.externalId`). */
  rosterId: string
}

type ChopRow = {
  leagueId: string
  seasonYear: number
  week: number
  rosterId: string | number
  pointsFor: number
}

export function importedChoppedLeagues(candidates: ReadonlyArray<ChopCandidate>, rows: ReadonlyArray<ChopRow>): Set<string> {
  const out = new Set<string>()
  for (const c of candidates) {
    const mine = rows.filter((r) => r.leagueId === c.platformLeagueId && r.seasonYear === c.seasonYear)
    if (mine.length === 0) continue
    if (choppedBefore(mine, c.currentWeek).has(String(c.rosterId))) out.add(c.leagueId)
  }
  return out
}
