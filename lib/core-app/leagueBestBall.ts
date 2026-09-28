import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { isBestBallSettings } from './lineupMode'

/**
 * Is this league best ball — a lineup the platform sets by itself, so a hurt
 * "starter" in it is not a decision anybody can make?
 *
 * Client-safe: no prisma, no 'server-only'.
 *
 * ⚠ THE COLUMN WAS NOT THE ANSWER FOR AN IMPORT. Measured on production
 * 2026-09-27: 344 Sleeper 2026 NFL leagues, 0 with `bestBallMode`, 0 with a
 * `best_ball` key in `settings` — the Sleeper mapper dropped the provider's flag.
 * #1371 restored it into `settings.best_ball` (and `lineupMode.isBestBallSettings`
 * reads it); the nightly re-import — 342 of 344 leagues inside 48h that day —
 * carries it onto existing rows, and imports now also write `bestBallMode`
 * (ImportedLeagueCommitService.buildTier0LeagueColumnPatch). Signals, in order:
 *
 *   1. `bestBallMode` / `leagueVariant` — native leagues and anything that set them;
 *   2. `leagueType === 'best_ball'` — the canonical concept column;
 *   3. the provider's flag in `settings`, read by `isBestBallSettings`.
 *
 * ⚠ NEVER THE LEAGUE NAME. #1371 settled it: "a league's name never proves its
 * lineup rules". This helper first shipped a name fallback for rows the fixed
 * importer had not reached; it was withdrawn to agree with that rule — misreading
 * a real lineup as best ball HIDES a starter who needs benching.
 */

export type BestBallLeagueFields = {
  name?: string | null
  bestBallMode?: boolean | null
  leagueVariant?: string | null
  leagueType?: string | null
  settings?: unknown
}

export type BestBallSource = 'column' | 'leagueType' | 'settings'

/** Why a league reads as best ball, or null when it does not. */
export function bestBallSource(league: BestBallLeagueFields): BestBallSource | null {
  if (isBestBallLeague(league.leagueVariant ?? null, league.bestBallMode ?? null)) return 'column'
  const type = String(league.leagueType ?? '').trim().toLowerCase()
  if (type === 'best_ball' || type === 'bestball') return 'leagueType'
  return isBestBallSettings(league.settings) ? 'settings' : null
}

export function isBestBallLeagueRow(league: BestBallLeagueFields): boolean {
  return bestBallSource(league) !== null
}
