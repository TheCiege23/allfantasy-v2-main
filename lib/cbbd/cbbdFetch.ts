import { cfbdGet, type CfbdResult } from '@/lib/cfbd-fetch'
import { getCfbdApiKey } from '@/lib/cfbd-env'

/**
 * CollegeBasketballData (CBBD) — the ADAPTER. Every export is a live call.
 *
 * CBBD is CFBD's sister API: the same key, the same monthly call quota, the same failure modes. So
 * the request itself goes through `cfbdGet` (lib/cfbd-fetch.ts), which sends the key as a Bearer
 * header, classifies a 429 as quota or throttle, and counts the shared quota off every response.
 *
 * Shapes are the committed captures in contracts/cbbd (ENDPOINTS.yaml, fixtures/), not the Python
 * client's docs: the wire is camelCase.
 *
 * DB-first: `CBBD_BASE_URL` is a monitored identifier in scripts/check-db-first-api-boundary.mjs and
 * this file is allowlisted by exact path. Its only runtime importers are the two ingestion modules,
 * lib/devy/cbbdDraftPicksStore.ts and lib/devy/cbbdDraftHistoryIngest.ts. Keep it that way — a request path that needs draft picks reads
 * the stored row, never this.
 */

export const CBBD_BASE_URL = 'https://api.collegebasketballdata.com'

/** One pick from `/draft/picks` (contracts/cbbd/fixtures/draft-picks-2025.json). */
export type CbbdDraftPick = {
  /** CBBD's athlete id — the same id as the draft-year roster's `players[].id`. Null for non-college picks, and occasionally for a college one. */
  athleteId: number | null
  draftTeam: string
  sourceTeamLocation: string | null
  sourceTeamName: string | null
  /** Null for a non-college pick (an international club). */
  sourceTeamCollegeId: number | null
  sourceTeamLeagueAffiliation: string | null
  year: number
  overall: number
  round: number
  pick: number
  name: string
  position: string | null
  /** Pre-draft rank among this draft's prospects (fixture: 58 of 59 set). Drafted players only, so no denominator. */
  overallRank?: number | null
  positionRank?: number | null
}

/** One team from `/teams/roster` (contracts/cbbd/fixtures/roster-*.json). */
export type CbbdRosterTeam = {
  teamId: number
  /** ESPN's team id, as a string. */
  teamSourceId: string | null
  team: string
  season: number
  players: Array<{ id: number; sourceId: string | null; name: string }>
}

export function getCbbdDraftPicks(year: number): Promise<CfbdResult<CbbdDraftPick[]>> {
  return cfbdGet<CbbdDraftPick[]>(`/draft/picks?year=${year}`, getCfbdApiKey(), CBBD_BASE_URL)
}

/** `season` is the season's END year: 2025 is 2024-25. */
export function getCbbdTeamRoster(season: number, team: string): Promise<CfbdResult<CbbdRosterTeam[]>> {
  return cfbdGet<CbbdRosterTeam[]>(
    `/teams/roster?season=${season}&team=${encodeURIComponent(team)}`,
    getCfbdApiKey(),
    CBBD_BASE_URL,
  )
}
