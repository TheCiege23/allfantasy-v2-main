import 'server-only'
import { prisma } from '@/lib/prisma'
import { readLeaguePair } from './pairRecord'

/**
 * A paired college + pro league as ONE franchise wherever the app lists things by league — the
 * notification inbox first. Both halves keep their own `leagueId` on every row (a notice still says
 * which league it came from); these add the franchise both belong to.
 *
 * Only the league-wide record (`settings.collegeProPair`) is read: one query, no provider, no viewer.
 * A pair that still lives only on its linker's franchise link joins once the linker opens it
 * (leaguePair.ts heals it then).
 */

export type FranchiseTag = {
  /** The PRO half's league id: one stable key for the pair, whichever half a row came from. */
  franchiseId: string
  /** "Peach Bowl (C2C) + Cream Bowl": pro half first. */
  franchiseName: string
}

/** The league and, when it is half of a recorded pair, its other half. */
export async function franchiseLeagueIds(leagueId: string): Promise<string[]> {
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }).catch(() => null)
  const pair = row ? readLeaguePair(row.settings) : null
  return pair ? [leagueId, pair.otherLeagueId] : [leagueId]
}

/** Franchise tags for every paired league among `leagueIds`. Unpaired leagues are absent from the map. */
export async function franchiseTagsFor(leagueIds: readonly string[]): Promise<Map<string, FranchiseTag>> {
  const out = new Map<string, FranchiseTag>()
  const ids = [...new Set(leagueIds.filter(Boolean))]
  if (ids.length === 0) return out
  const rows = await prisma.league.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, settings: true } }).catch(() => [])
  const pairs = rows.flatMap((r) => {
    const pair = readLeaguePair(r.settings)
    return pair ? [{ id: r.id, name: r.name, pair }] : []
  })
  if (pairs.length === 0) return out

  const names = new Map(rows.map((r) => [r.id, (r.name ?? '').trim()]))
  const missing = [...new Set(pairs.map((p) => p.pair.otherLeagueId))].filter((id) => !names.has(id))
  if (missing.length > 0) {
    const others = await prisma.league.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } }).catch(() => [])
    for (const o of others) names.set(o.id, (o.name ?? '').trim())
  }
  for (const { id, pair } of pairs) {
    const proId = pair.role === 'pro' ? id : pair.otherLeagueId
    const collegeId = pair.role === 'pro' ? pair.otherLeagueId : id
    const proName = names.get(proId) || 'Pro league'
    const collegeName = names.get(collegeId) || 'College league'
    out.set(id, { franchiseId: proId, franchiseName: `${proName} + ${collegeName}` })
  }
  return out
}
