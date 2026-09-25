import 'server-only'
import type { LineupVerification } from './lineupVerification'

import { sleeperGet } from '@/lib/trade-intel/sleeperTradeSync'

type LiveRoster = {
  roster_id: number
  owner_id: string | null
  co_owners?: string[] | null
  players: string[] | null
  starters: string[]
  reserve?: string[] | null
  taxi?: string[] | null
}

const readRosters = (leagueId: string) =>
  sleeperGet<LiveRoster[]>(`/league/${encodeURIComponent(leagueId)}/rosters`)

export async function currentSleeperRoster(
  leagueId: string,
  team: { platformUserId?: string | null; externalId?: string | null },
): Promise<(Record<string, unknown> & {
  verification: LineupVerification
  /**
   * EVERY roster's starters for `verification.week`, keyed by Sleeper `roster_id` as a string
   * (which is `WeeklyMatchup.rosterId` / `LeagueTeam.externalId`). Read from the same weekly
   * matchups response as your own lineup, so it costs no extra request. A roster is present only
   * when its row passes the same checks yours must; absent means unknown, never "no starters".
   * Null outside the season, when there is no weekly lineup to read.
   *
   * 🛑 THE OPPONENT'S SIDE OF THE MATCHUP CARD WAS PRICED FROM THE STORED `Roster` ROW — whatever
   * the last sync wrote — while yours was the live lineup. A starter the opponent benched since
   * then still counted for them.
   */
  weekStarters: Record<string, string[]> | null
}) | null> {
  const [rows, league] = await Promise.all([
    readRosters(leagueId).catch(() => null),
    sleeperGet<{ status: string; roster_positions?: string[]; settings?: { leg?: number } }>(
      `/league/${encodeURIComponent(leagueId)}`,
    ).catch(() => null),
  ])
  if (!Array.isArray(rows) || !league) return null
  // An owner id is authoritative. Never fall through to a different owner's
  // roster just because an old roster number still matches after reassignment.
  const matches = team.platformUserId
    ? rows.filter((r) => r.owner_id === team.platformUserId || r.co_owners?.includes(team.platformUserId!))
    : rows.filter((r) => String(r.roster_id) === team.externalId)
  const row = matches.length === 1 ? matches[0] : null
  if (!row || !Array.isArray(row.starters) || (row.players != null && !Array.isArray(row.players))) return null
  // Sleeper's roster starters can disagree with the live weekly lineup. The
  // matchup endpoint is authoritative for this week's starter slots (including
  // bye teams with a null matchup_id). Never fall back to the stale roster list.
  let currentStarters = row.starters
  let matchups: Array<{ roster_id: number; starters: string[] }> | null = null
  if (league.status === 'in_season') {
    const week = league.settings?.leg
    if (!Number.isInteger(week) || week! < 1 || week! > 53) return null
    matchups = await sleeperGet<Array<{ roster_id: number; starters: string[] }>>(
      `/league/${encodeURIComponent(leagueId)}/matchups/${week}`,
    ).catch(() => null)
    if (!Array.isArray(matchups)) return null
    const weekly = weeklyStarters(matchups, row)
    if (!weekly) return null
    currentStarters = weekly
  }
  if (!startersAreActive(row, currentStarters)) return null
  const starters = normalizeStarters(currentStarters)

  // Every other roster through the same checks as yours; one that fails is left out, not guessed.
  let weekStarters: Record<string, string[]> | null = null
  if (matchups) {
    weekStarters = {}
    for (const other of rows) {
      const weekly = weeklyStarters(matchups, other)
      if (weekly && startersAreActive(other, weekly)) weekStarters[String(other.roster_id)] = normalizeStarters(weekly)
    }
  }
  return { players: row.players ?? [], starters, reserve: row.reserve ?? [], taxi: row.taxi ?? [], weekStarters, verification: {
    checkedAt: new Date().toISOString(), source: 'Sleeper',
    week: league.status === 'in_season' ? league.settings!.leg! : null,
    slots: (league.roster_positions ?? []).filter((s) => !['BN', 'IR', 'TAXI'].includes(s)),
  } }
}

/** This roster's starters from the weekly matchups response; null unless exactly one usable row. */
function weeklyStarters(
  matchups: Array<{ roster_id: number; starters: string[] }>,
  row: LiveRoster,
): string[] | null {
  const matching = matchups.filter((m) => m.roster_id === row.roster_id)
  return matching.length === 1 && Array.isArray(matching[0].starters) ? matching[0].starters : null
}

/** Conflicting assignments are unknown, never a reason to flag a starter. */
function startersAreActive(row: LiveRoster, starters: string[]): boolean {
  if ((row.reserve != null && !Array.isArray(row.reserve)) || (row.taxi != null && !Array.isArray(row.taxi))) return false
  const inactive = new Set([...(row.reserve ?? []), ...(row.taxi ?? [])])
  return !starters.some((id) => id && id !== '0' && inactive.has(id))
}

/**
 * Preserve empty positions: downstream filters must not move the next player into the wrong
 * starting slot when the provider returns null or an empty id.
 */
function normalizeStarters(starters: string[]): string[] {
  return starters.map((id) => (id == null || id === '' ? '0' : id))
}
