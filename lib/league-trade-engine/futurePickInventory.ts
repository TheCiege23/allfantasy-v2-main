/**
 * Which future draft picks each team of an IMPORTED league holds — pure, no IO.
 *
 * 🛑 THE TRADE CENTER LISTED NO REAL PICKS. It read picks only from `Roster.playerData`, and on
 * staging 2026-09-17 that yielded a proposable pick in 0 of 290 leagues: in manual leagues
 * `playerData.draftPicks` holds DRAFTED PLAYERS, and imported leagues keep their picks in
 * `future_draft_picks` — 3,382 rows across 115 leagues that nothing on the trade screen read.
 *
 * ⚠ THAT TABLE HOLDS ONLY PICKS THAT HAVE BEEN TRADED. Every writer is `persistTradedPicks`, fed by
 * Sleeper's `/traded_picks` (and MFL's list filtered to moved picks): all 3,373 Sleeper rows carry
 * `traded: true`. A team's own untraded 2027 1st — the pick a manager most often wants to offer — is
 * not a row anywhere. So the inventory is REBUILT: every team owns its own pick in every round of
 * every upcoming draft, and a stored row, where one exists, says who holds it instead.
 *
 * ⚠ ONLY WHEN THE ROUND COUNT IS KNOWN. Inventing a 4th-round pick in a 3-round league would put a
 * pick on the screen that does not exist. The count comes from the league's own draft history
 * (`rookieRoundsFromDraftHistory`); when it cannot be told, only the stored rows are listed and the
 * caller says so.
 *
 * Ids are the PROVIDER's team ids (`LeagueTeam.externalId`), the space `future_draft_picks` is
 * written in — Sleeper roster numbers, MFL franchise ids. Never `Roster.id`.
 */

export type StoredFuturePick = {
  pickSeason: number
  round: number
  originalRosterId: string
  currentOwnerId: string
}

/** One season of a league's draft history: its largest round and how many picks it recorded. */
export type DraftSeasonSize = { season: number; maxRound: number; picks: number }

export type InventoryPick = {
  season: number
  round: number
  /** Provider team id of the team that holds the pick now. */
  ownerTeamId: string
  /** Provider team id of the team the pick originally belonged to. */
  originalTeamId: string
  /** `stored` when a `future_draft_picks` row says who holds it; `own` when rebuilt. */
  source: 'stored' | 'own'
}

/** A rookie draft is short; a league's startup draft is not. Larger single drafts are not trusted. */
const MAX_ROOKIE_ROUNDS = 7

/**
 * The league's rookie-draft round count, read from its own completed drafts; null when it cannot
 * be told.
 *
 * Measured on staging 2026-09-17 (dynasty leagues with stored picks): the latest recorded draft was
 * complete — picks = teams × rounds — in 96 of 103, and the league's FIRST recorded season is
 * usually its startup (WDTAZ: 25 rounds in 2020, then 3 every year). So:
 *   - only complete drafts count;
 *   - the earliest season is skipped when there is more than one, as the likely startup;
 *   - a league with a single recorded draft is trusted only if that draft is rookie-sized.
 */
export function rookieRoundsFromDraftHistory(seasons: DraftSeasonSize[], teams: number): number | null {
  if (!(teams > 0)) return null
  const ordered = [...seasons].sort((a, b) => a.season - b.season)
  const complete = (s: DraftSeasonSize) => s.maxRound > 0 && s.picks === teams * s.maxRound
  if (ordered.length > 1) {
    const later = ordered.slice(1).filter(complete)
    return later.length > 0 ? later[later.length - 1]!.maxRound : null
  }
  const only = ordered[0]
  return only && complete(only) && only.maxRound <= MAX_ROOKIE_ROUNDS ? only.maxRound : null
}

/**
 * The drafts whose picks can still change hands.
 *
 * ⚠ THE CURRENT SEASON'S DRAFT IS USUALLY OVER. Two thirds of the stored rows (2,217 of 3,382) are
 * for the league's current season, and 111 of those leagues report `in_season`: those picks were
 * used months ago, and the table never marks them so. Only a league still `pre_draft` or `drafting`
 * has a current-season pick left to trade.
 *
 * Three seasons, which is the horizon Sleeper lets picks be traded over (the stored rows reach three
 * seasons past the current one and no further).
 */
export function upcomingDraftSeasons(args: {
  leagueSeason: number
  status: string | null | undefined
  years?: number
}): number[] {
  const open = args.status === 'pre_draft' || args.status === 'drafting'
  const start = open ? args.leagueSeason : args.leagueSeason + 1
  const years = args.years && args.years > 0 ? args.years : 3
  return Array.from({ length: years }, (_, i) => start + i)
}

/**
 * Every pick in the given drafts and who holds it.
 *
 * With `rounds` known: each team's own pick in each round, moved to its holder where a stored row
 * says so, plus any stored pick in a round past that count (a league that changed its format keeps
 * the picks it traded). With `rounds` null: the stored picks alone.
 */
export function futurePickInventory(args: {
  teamIds: string[]
  seasons: number[]
  rounds: number | null
  stored: StoredFuturePick[]
}): InventoryPick[] {
  const inHorizon = new Set(args.seasons)
  const key = (season: number, round: number, original: string) => `${season}:${round}:${original}`
  const stored = new Map<string, StoredFuturePick>()
  for (const row of args.stored) {
    if (!inHorizon.has(row.pickSeason) || !(row.round > 0)) continue
    stored.set(key(row.pickSeason, row.round, row.originalRosterId), row)
  }

  const out: InventoryPick[] = []
  const used = new Set<string>()
  if (args.rounds != null && args.rounds > 0) {
    for (const season of args.seasons) {
      for (let round = 1; round <= args.rounds; round++) {
        for (const team of args.teamIds) {
          const k = key(season, round, team)
          const row = stored.get(k)
          if (row) used.add(k)
          out.push({
            season,
            round,
            ownerTeamId: row?.currentOwnerId ?? team,
            originalTeamId: team,
            source: row ? 'stored' : 'own',
          })
        }
      }
    }
  }
  for (const [k, row] of stored) {
    if (used.has(k)) continue
    out.push({
      season: row.pickSeason,
      round: row.round,
      ownerTeamId: row.currentOwnerId,
      originalTeamId: row.originalRosterId,
      source: 'stored',
    })
  }
  return out.sort((a, b) => a.season - b.season || a.round - b.round || a.originalTeamId.localeCompare(b.originalTeamId))
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st" … */
export function roundOrdinal(round: number): string {
  const mod100 = round % 100
  if (mod100 >= 11 && mod100 <= 13) return `${round}th`
  switch (round % 10) {
    case 1:
      return `${round}st`
    case 2:
      return `${round}nd`
    case 3:
      return `${round}rd`
    default:
      return `${round}th`
  }
}

/**
 * A stable id for a pick that has no row of its own. Namespaced so it can never be mistaken for a
 * `playerData` pick id, which is what a proposal references — these picks are not proposable.
 */
export function inventoryPickId(p: Pick<InventoryPick, 'season' | 'round' | 'originalTeamId'>): string {
  return `fdp:${p.season}:${p.round}:${p.originalTeamId}`
}
