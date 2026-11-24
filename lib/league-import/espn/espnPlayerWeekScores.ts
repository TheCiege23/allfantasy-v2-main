/**
 * ESPN NFL: each rostered player's fantasy points for the CURRENT week, out of a league response the
 * sync already fetched (GAPS.md PS-01). PURE — no prisma, no fetch — so it is tested against the
 * committed capture (`contracts/espn/fixtures/fantasy-matchup.NFL.2026.week11.json`, see
 * `fantasy_nfl_matchup` in ENDPOINTS.yaml). The writer is `./espnPlayerWeekScoresWriter.ts`.
 *
 * WHAT IS READ, AND WHY ONLY THIS:
 *   - `schedule[].home|away.rosterForCurrentScoringPeriod.entries[]` of the CURRENT matchup period. Every
 *     rostered player, bench (20) and IR (21) included, with his real `lineupSlotId` and his own points in
 *     the league's scoring (`playerPoolEntry.appliedStatTotal`).
 *   - 🛑 NEVER `rosterForMatchupPeriod`: it reports `lineupSlotId` 0 for every entry and holds starters only.
 *   - 🛑 `lineupLocked: false` means his game has not started, and his 0 is NOT a score. He is skipped,
 *     never written as 0. A locked player is written each sync; the last value written stands.
 *   - Past weeks carry no roster block, so only the current week is ever produced (S-01 stays unprobed).
 *
 * ⚠ THE WEEK IS THE SCORING PERIOD, AND IT MUST EQUAL THE MATCHUP PERIOD. The block is one SCORING
 * period, and the bench ledger records NFL weeks. In a league whose playoff matchup spans two NFL weeks
 * the two numbers part, and which week the block then describes is not in any capture — so that response
 * produces nothing (`reason: 'period-mismatch'`) rather than a row filed under a guessed week.
 *
 * ⚠ IDS ARE ESPN'S HERE. ESPN 12483 is Matthew Stafford; Sleeper 12483 is Jack Bech. The writer
 * crosswalks before storing; nothing may store these ids as they are.
 */

export const ESPN_BENCH_SLOT = 20
export const ESPN_IR_SLOT = 21

export type EspnPlayerWeekScore = {
  /** ESPN's own player id, as a string. D/ST is negative: -16000 - proTeamId. */
  espnPlayerId: string
  /** ESPN team id of the side that rosters him (`schedule[].home|away.teamId`). */
  teamId: number
  lineupSlotId: number
  /** Not bench (20), not IR (21). */
  isStarter: boolean
  /** The league's own scoring, as ESPN applied it. Never recomputed. */
  points: number
}

export type EspnPlayerWeekScoresParse = {
  season: number | null
  week: number | null
  rows: EspnPlayerWeekScore[]
  /** Sides of the current period that carried a roster block. */
  sides: number
  /** Entries skipped because the player's game had not started (`lineupLocked` false). */
  unlocked: number
  /** Entries skipped because the id, slot or points could not be read. */
  malformed: number
  /** Why nothing could be read at all, when that is the case. */
  reason: 'no-week' | 'period-mismatch' | 'no-roster-block' | null
}

function intOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isInteger(n) ? n : null
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseEspnCurrentWeekPlayerScores(raw: unknown): EspnPlayerWeekScoresParse {
  const r = isRecord(raw) ? raw : {}
  const season = intOf(r.seasonId)
  const matchupPeriod = intOf(r.status?.currentMatchupPeriod)
  const scoringPeriod = intOf(r.scoringPeriodId) ?? intOf(r.status?.latestScoringPeriod)
  const empty = (reason: EspnPlayerWeekScoresParse['reason'], week: number | null = null): EspnPlayerWeekScoresParse => ({
    season, week, rows: [], sides: 0, unlocked: 0, malformed: 0, reason,
  })
  if (matchupPeriod == null || scoringPeriod == null || matchupPeriod < 1) return empty('no-week')
  if (matchupPeriod !== scoringPeriod) return empty('period-mismatch')

  const byPlayer = new Map<string, EspnPlayerWeekScore>()
  const conflicted = new Set<string>()
  let sides = 0
  let unlocked = 0
  let malformed = 0
  for (const matchup of Array.isArray(r.schedule) ? r.schedule : []) {
    if (!isRecord(matchup) || intOf(matchup.matchupPeriodId) !== matchupPeriod) continue
    for (const side of [matchup.home, matchup.away]) {
      if (!isRecord(side)) continue
      const block = side.rosterForCurrentScoringPeriod
      const teamId = intOf(side.teamId)
      if (!isRecord(block) || !Array.isArray(block.entries) || teamId == null) continue
      sides++
      for (const entry of block.entries) {
        const pool = isRecord(entry) ? entry.playerPoolEntry : null
        const id = isRecord(entry) ? intOf(entry.playerId) : null
        const slot = isRecord(entry) ? intOf(entry.lineupSlotId) : null
        if (!isRecord(pool) || id == null || id === 0 || slot == null) {
          malformed++
          continue
        }
        if (pool.lineupLocked !== true) {
          unlocked++
          continue
        }
        const points = typeof pool.appliedStatTotal === 'number' && Number.isFinite(pool.appliedStatTotal) ? pool.appliedStatTotal : null
        if (points == null) {
          malformed++
          continue
        }
        const key = String(id)
        const row: EspnPlayerWeekScore = {
          espnPlayerId: key,
          teamId,
          lineupSlotId: slot,
          isStarter: slot !== ESPN_BENCH_SLOT && slot !== ESPN_IR_SLOT,
          points,
        }
        // One player on two sides cannot happen in one league; if it ever does, neither side is believed.
        if (byPlayer.has(key) && byPlayer.get(key)!.teamId !== teamId) conflicted.add(key)
        byPlayer.set(key, row)
      }
    }
  }
  for (const key of conflicted) byPlayer.delete(key)
  malformed += conflicted.size
  if (sides === 0) return empty('no-roster-block', scoringPeriod)
  return { season, week: scoringPeriod, rows: [...byPlayer.values()], sides, unlocked, malformed, reason: null }
}

/**
 * The leagueId ESPN rows are stored under: `espn:<platformLeagueId>`, never the bare id.
 *
 * 🛑 THE BARE ID WOULD HAND A STRANGER'S POINTS TO EVERY READER THAT LOOKS PLAYERS UP BY THE ROSTER'S ID.
 * These rows hold SLEEPER ids (the ledger grades on them). Several readers of this table — the matchup
 * board (`matchup.ts`), game day (`myTeamGameDay.ts`), the live win inputs (`matchupWinInputs.ts`), the live
 * page — read a league's rows by `platformLeagueId` and the ids its ROSTER holds, which for ESPN are ESPN
 * ids. Under the bare key, an ESPN roster id that equals some other rostered player's Sleeper id (ESPN 12483
 * = Stafford, Sleeper 12483 = Bech) would read that other player's points, silently. Every reader that
 * reads by `platformLeagueId` therefore sees nothing for an ESPN league, exactly as before this writer;
 * the bench ledger (`ledgerGrading.ts loadBenchRows`) joins on this key explicitly.
 */
export function espnPlayerScoreLeagueKey(platformLeagueId: string): string {
  return `espn:${platformLeagueId}`
}

export const ESPN_PLAYER_SCORE_SOURCE = 'espn'

export type SleeperKeyedWeekScore = Omit<EspnPlayerWeekScore, 'espnPlayerId' | 'lineupSlotId'> & {
  sleeperId: string
  espnPlayerId: string
}

/**
 * ESPN ids → canonical Sleeper ids, through a crosswalk the caller built (`crosswalkToSleeperIds` +
 * `withTeamDefenseIds`). PURE. A player with no Sleeper id is SKIPPED, never stored under his ESPN id; two
 * ESPN players that land on one Sleeper id are both skipped — the crosswalk is one-to-one per ESPN id, not
 * per Sleeper id, and choosing either would grade a call on a guess.
 */
export function toSleeperKeyedScores(
  rows: readonly EspnPlayerWeekScore[],
  crosswalk: ReadonlyMap<string, string>,
): { rows: SleeperKeyedWeekScore[]; unmapped: number; ambiguous: number } {
  const byTarget = new Map<string, SleeperKeyedWeekScore[]>()
  let unmapped = 0
  for (const row of rows) {
    const sleeperId = crosswalk.get(row.espnPlayerId)?.trim()
    if (!sleeperId) {
      unmapped++
      continue
    }
    const list = byTarget.get(sleeperId) ?? []
    list.push({ sleeperId, espnPlayerId: row.espnPlayerId, teamId: row.teamId, isStarter: row.isStarter, points: row.points })
    byTarget.set(sleeperId, list)
  }
  const out: SleeperKeyedWeekScore[] = []
  let ambiguous = 0
  for (const list of byTarget.values()) {
    if (list.length === 1) out.push(list[0])
    else ambiguous += list.length
  }
  return { rows: out, unmapped, ambiguous }
}
