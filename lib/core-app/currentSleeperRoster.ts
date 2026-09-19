import 'server-only'

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
): Promise<Record<string, unknown> | null> {
  const rows = await readRosters(leagueId).catch(() => null)
  if (!Array.isArray(rows)) return null
  // An owner id is authoritative. Never fall through to a different owner's
  // roster just because an old roster number still matches after reassignment.
  const matches = team.platformUserId
    ? rows.filter((r) => r.owner_id === team.platformUserId || r.co_owners?.includes(team.platformUserId!))
    : rows.filter((r) => String(r.roster_id) === team.externalId)
  const row = matches.length === 1 ? matches[0] : null
  if (!row || !Array.isArray(row.starters) || (row.players != null && !Array.isArray(row.players))) return null
  // Conflicting assignments are unknown, never a reason to flag a starter.
  if ((row.reserve != null && !Array.isArray(row.reserve)) || (row.taxi != null && !Array.isArray(row.taxi))) return null
  const inactive = new Set([...(row.reserve ?? []), ...(row.taxi ?? [])])
  if (row.starters.some((id) => id && id !== '0' && inactive.has(id))) return null
  // Preserve empty positions: downstream filters must not move the next player
  // into the wrong starting slot when the provider returns null or an empty id.
  const starters = row.starters.map((id) => id == null || id === '' ? '0' : id)
  return { players: row.players ?? [], starters, reserve: row.reserve ?? [], taxi: row.taxi ?? [] }
}
