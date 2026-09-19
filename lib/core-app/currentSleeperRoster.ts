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
): Promise<(Record<string, unknown> & { verification: LineupVerification }) | null> {
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
  if (league.status === 'in_season') {
    const week = league.settings?.leg
    if (!Number.isInteger(week) || week! < 1 || week! > 53) return null
    const matchups = await sleeperGet<Array<{ roster_id: number; starters: string[] }>>(
      `/league/${encodeURIComponent(leagueId)}/matchups/${week}`,
    ).catch(() => null)
    if (!Array.isArray(matchups)) return null
    const matching = matchups.filter((m) => m.roster_id === row.roster_id)
    if (matching.length !== 1 || !Array.isArray(matching[0].starters)) return null
    currentStarters = matching[0].starters
  }
  // Conflicting assignments are unknown, never a reason to flag a starter.
  if ((row.reserve != null && !Array.isArray(row.reserve)) || (row.taxi != null && !Array.isArray(row.taxi))) return null
  const inactive = new Set([...(row.reserve ?? []), ...(row.taxi ?? [])])
  if (currentStarters.some((id) => id && id !== '0' && inactive.has(id))) return null
  // Preserve empty positions: downstream filters must not move the next player
  // into the wrong starting slot when the provider returns null or an empty id.
  const starters = currentStarters.map((id) => id == null || id === '' ? '0' : id)
  return { players: row.players ?? [], starters, reserve: row.reserve ?? [], taxi: row.taxi ?? [], verification: {
    checkedAt: new Date().toISOString(), source: 'Sleeper',
    week: league.status === 'in_season' ? league.settings!.leg! : null,
    slots: (league.roster_positions ?? []).filter((s) => !['BN', 'IR', 'TAXI'].includes(s)),
  } }
}
