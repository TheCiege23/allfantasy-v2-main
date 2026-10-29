/**
 * MAX SEASONS ON THE TAXI SQUAD — how many seasons a player may spend on a taxi squad in this
 * league before the player has to come off it.
 *
 * A commissioner setting (`League.settings.taxi_max_years`), 2 by default: a league that never
 * touched it plays to 2. A commissioner can pick 1–5 or "no limit" (stored as `0`), on any plan. It is distinct
 * from `taxiYearsLimit`, which is about a player's NFL experience; this is about time spent stashed.
 *
 * THE COUNT is derived, never stored: the distinct COMPLETED seasons of this league in which the
 * player finished on any team's taxi squad (`RedraftRosterPlayer.slotType = TAXI`, not dropped). A
 * dynasty roster is copied into each new season, so every finished season keeps its own rows. It
 * counts across teams on purpose — a trade does not reset the clock. The season being played is
 * never counted; it is not over.
 *
 * Where it bites:
 *   the season start   a player whose seasons are used is moved to the bench
 *                      (lib/redraft/offseason/dynastyRolloverHousekeeping.ts)
 *   a lineup save      a player whose seasons are used cannot be put on the taxi squad
 *                      (./taxiRulesService.ts)
 * A player already on the squad mid-season is never moved by a save.
 */
import type { Prisma } from '@prisma/client'

export const TAXI_MAX_YEARS_KEY = 'taxi_max_years'
export const TAXI_MAX_YEARS_DEFAULT = 2
export const TAXI_MAX_YEARS_CHOICES = [1, 2, 3, 4, 5] as const

/** Null: no limit. Unset (or anything unreadable) is the default. */
export function readTaxiMaxYears(settings: unknown): number | null {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[TAXI_MAX_YEARS_KEY] : undefined
  if (raw === 0) return null
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 5 ? raw : TAXI_MAX_YEARS_DEFAULT
}

/** The stored value for a choice: a number of seasons, or 0 for no limit. */
export function storedTaxiMaxYears(choice: number | null): number {
  return choice == null ? 0 : choice
}

export function hasUsedTaxiSeasons(seasonsUsed: number, maxYears: number | null): boolean {
  return maxYears != null && seasonsUsed >= maxYears
}

const TAXI_SLOTS = ['TAXI', 'taxi', 'Taxi']

type TenureDb = { redraftRosterPlayer: Pick<Prisma.TransactionClient['redraftRosterPlayer'], 'findMany'> }

/** Completed seasons each player finished on a taxi squad in this league. Players never on one are absent. */
export async function loadTaxiSeasonsUsed(db: TenureDb, leagueId: string, playerIds: readonly string[]): Promise<Map<string, number>> {
  if (playerIds.length === 0) return new Map()
  const rows = await db.redraftRosterPlayer.findMany({
    where: {
      playerId: { in: [...new Set(playerIds)] },
      droppedAt: null,
      slotType: { in: TAXI_SLOTS },
      roster: { leagueId, season: { status: 'complete' } },
    },
    select: { playerId: true, roster: { select: { seasonId: true } } },
  })
  const seasons = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = seasons.get(r.playerId) ?? new Set<string>()
    set.add(r.roster.seasonId)
    seasons.set(r.playerId, set)
  }
  return new Map([...seasons].map(([id, set]) => [id, set.size]))
}
