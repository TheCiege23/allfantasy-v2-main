/**
 * Mock draft team counts — the SAME sizes a real league of that sport and type accepts.
 *
 * Mock drafts used to hard-code 8–16 (and the open room 8–14), so a manager in a 4-, 6-, 18- or
 * 20-team league, or an odd-sized redraft league, could not rehearse his own draft. The list now
 * comes from `getTeamCountOptions` (lib/create-league-v2/rules-engine.ts), which reads the league
 * create catalog `POST /api/leagues` validates against. So a size is offered for a mock exactly when
 * a league of that sport/type may be created with it, and one edit to the catalog moves both.
 *
 * A mock's league type is `redraft` or `dynasty`; anything else reads as redraft.
 */
import type { SupportedSport } from '@/lib/create-league-v2/state'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { UNIVERSAL_CREATE_TEAM_COUNTS } from '@/lib/create-league-v2/simple-create'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export const DEFAULT_MOCK_TEAM_COUNT = 12

export type MockTeamCountLeagueType = 'redraft' | 'dynasty'

export function mockTeamCountLeagueType(leagueType: unknown): MockTeamCountLeagueType {
  return String(leagueType ?? '').toLowerCase() === 'dynasty' ? 'dynasty' : 'redraft'
}

/** Every team count a league of this sport and type accepts, ascending. */
export function getMockDraftTeamCountOptions(sport: unknown, leagueType?: unknown): number[] {
  const s = normalizeToSupportedSport(String(sport ?? 'NFL')) as SupportedSport
  const opts = getTeamCountOptions(s, mockTeamCountLeagueType(leagueType))
  const clean = [...new Set(opts.filter((n) => Number.isInteger(n) && n >= 2))].sort((a, b) => a - b)
  return clean.length > 0 ? clean : [DEFAULT_MOCK_TEAM_COUNT]
}

/**
 * A requested team count, made one the league list accepts: an allowed size is kept as is; a
 * missing or unreadable one is the default (12, or the list's middle when 12 is not offered); any
 * other size moves to the nearest allowed one (the smaller on a tie), so a saved 8–16 mock from
 * before still reads exactly as it was saved.
 */
export function normalizeMockDraftTeamCount(raw: unknown, sport: unknown, leagueType?: unknown): number {
  const opts = getMockDraftTeamCountOptions(sport, leagueType)
  const fallback = opts.includes(DEFAULT_MOCK_TEAM_COUNT) ? DEFAULT_MOCK_TEAM_COUNT : opts[Math.floor(opts.length / 2)]!
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  const want = Math.round(n)
  if (opts.includes(want)) return want
  let best = opts[0]!
  for (const o of opts) if (Math.abs(o - want) < Math.abs(best - want)) best = o
  return best
}

/**
 * The team count of a real league for the league-derived mock tools (pick path, board prediction,
 * snipe radar, trade optimizer): its configured size, else how many teams it has, else 12. Never a
 * floor of 12 — that turned a 4- or 10-team league into a 12-team draft with picks that do not exist.
 */
export function resolveLeagueMockTeamCount(leagueSize: number | null | undefined, teamsOnRecord: number): number {
  if (typeof leagueSize === 'number' && Number.isInteger(leagueSize) && leagueSize >= 2) return leagueSize
  if (teamsOnRecord >= 2) return teamsOnRecord
  return DEFAULT_MOCK_TEAM_COUNT
}

/** Largest team count any league may have — the league-derived tools read this many team rows. */
export const MAX_LEAGUE_MOCK_TEAMS = Math.max(...UNIVERSAL_CREATE_TEAM_COUNTS)

/** Team indexes (0-based) in pick order for one round. Snake reverses even rounds; linear never does. */
export function mockRoundOrder(teamCount: number, round: number, draftType: 'snake' | 'linear' = 'snake'): number[] {
  const arr = Array.from({ length: teamCount }, (_, i) => i)
  return draftType === 'snake' && round % 2 === 0 ? arr.reverse() : arr
}

/** Overall pick numbers (1-based) a team (0-based index) makes in the first `rounds` rounds. */
export function mockTeamPickOveralls(
  teamCount: number,
  teamIdx: number,
  rounds: number,
  draftType: 'snake' | 'linear' = 'snake',
): number[] {
  const picks: number[] = []
  for (let r = 1; r <= rounds; r++) {
    const slot = mockRoundOrder(teamCount, r, draftType).indexOf(teamIdx)
    if (slot >= 0) picks.push((r - 1) * teamCount + slot + 1)
  }
  return picks
}
