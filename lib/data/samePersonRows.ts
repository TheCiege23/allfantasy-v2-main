import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'

/**
 * Player rows that are COPIES of one athlete, collapsed to one — and namesakes left alone.
 *
 * 🛑 `sports_players` HOLDS A PLAYER ONCE PER SOURCE. Juan Soto is `MLB:2354` (Rolling Insights),
 * `MLB:tsdb_34166384` (TheSportsDB) and `MLB:juan-soto:NEW YORK METS`; searching "Skubal" listed three
 * Tarik Skubals, two at LAD and one at DETROIT TIGERS (2026-10-11). Measured in production that day: of the
 * names carried by more than one row, ONE identity holds 1,517 of 1,562 in MLB, 1,621 of 1,629 in the
 * NBA and 1,782 of 1,798 in the NHL.
 *
 * ⚠ BUT SOME ARE NAMESAKES — Will Smith is the Dodgers' catcher and a Royals pitcher; four Luis Garcias are
 * on file — so rows are never merged on the name alone. `PlayerIdentityMap` keeps one row per athlete (the
 * id space the projection board is keyed on), and decides per name: one identity in this sport, and that
 * name's rows are his; two or more, none, or a map that cannot be read, and they stay as they are. The
 * analyzer's typed-name lookup and the player search both use this, so a name the analyzer accepts is a
 * name the search shows once.
 *
 * The row kept is the one keyed on his Rolling Insights id (`<SPORT>:<riId>`) when there is one — it
 * carries the current club; Skubal's 2026 rows say LAD, an April copy still says DETROIT TIGERS — else
 * the first of his rows in the order given (the search returns the newest first). It takes the place of
 * his first row; every other row keeps its order.
 */
export async function collapseSamePersonRows<T extends { id: string; name: string; team?: string | null }>(
  rows: readonly T[],
  sport: string,
): Promise<T[]> {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const key = normalizePlayerName(r.name)
    if (!key) continue
    const group = groups.get(key)
    if (group) group.push(r)
    else groups.set(key, [r])
  }
  const shared = [...groups].filter(([, g]) => g.length > 1).map(([key]) => key)
  if (shared.length === 0) return [...rows]

  let people: Array<{ normalizedName: string; rollingInsightsId: string | null }>
  try {
    people = await prisma.playerIdentityMap.findMany({
      where: { sport, normalizedName: { in: shared } },
      select: { normalizedName: true, rollingInsightsId: true },
    })
  } catch {
    return [...rows]
  }
  const identities = new Map<string, Array<string | null>>()
  for (const p of people) identities.set(p.normalizedName, [...(identities.get(p.normalizedName) ?? []), p.rollingInsightsId])

  const keep = new Map<string, T>()
  for (const key of shared) {
    const ids = identities.get(key)
    if (!ids || ids.length !== 1) continue
    const group = groups.get(key)!
    const ri = ids[0]?.trim()
    const chosen = (ri ? group.find((r) => r.id === `${sport}:${ri}`) : undefined) ?? group[0]!
    /*
     * ⚠ SOCCER'S ROLLING INSIGHTS ROWS CARRY A CLUB NUMBER, NOT A CLUB: 1,103 of 1,264 read "13" where
     * Haaland's TheSportsDB copy reads "MNC" (production, 2026-10-11; no other sport has one). The row stays
     * his — its id is the one the board answers to — and the club is taken from a copy that names it.
     */
    const named = isClubNumber(chosen.team) ? group.find((r) => r.team?.trim() && !isClubNumber(r.team)) : undefined
    keep.set(key, named ? { ...chosen, team: named.team } : chosen)
  }
  if (keep.size === 0) return [...rows]

  const out: T[] = []
  const placed = new Set<string>()
  for (const r of rows) {
    const key = normalizePlayerName(r.name)
    const kept = keep.get(key)
    if (!kept) {
      out.push(r)
      continue
    }
    if (placed.has(key)) continue
    placed.add(key)
    out.push(kept)
  }
  return out
}

function isClubNumber(team: string | null | undefined): boolean {
  return /^\d+$/.test(String(team ?? '').trim())
}
