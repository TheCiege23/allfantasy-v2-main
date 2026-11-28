/**
 * Soccer clubs by Rolling Insights' numeric club id.
 *
 * 🛑 A ROLLING INSIGHTS SOCCER PLAYER'S `team` IS A NUMBER ("17"), and every surface that showed a soccer
 * player's team showed that number: the draft board, rosters, the waiver wire, trade cards. The stored
 * Rolling Insights team rows name each one (17 → Tottenham Hotspur, TOT; 7 → Crystal Palace, CRY),
 * which is how the logos were already found. This is the one lookup every surface reads, so a club is
 * named the same way everywhere. Only a purely numeric team is ever renamed.
 */
import { prisma } from '@/lib/prisma'

export type SoccerClub = { name: string; shortName: string | null }

const TTL_MS = 10 * 60_000
let memo: { at: number; clubs: Map<string, SoccerClub> } | null = null

export async function loadSoccerClubNames(now = Date.now()): Promise<Map<string, SoccerClub>> {
  if (memo && now - memo.at < TTL_MS) return memo.clubs
  const rows = await prisma.sportsTeam.findMany({
    where: { sport: 'SOCCER', source: 'rolling_insights' },
    select: { externalId: true, name: true, shortName: true },
  })
  const clubs = new Map<string, SoccerClub>()
  for (const r of rows) {
    const id = String(r.externalId ?? '').trim()
    if (id && r.name?.trim()) clubs.set(id, { name: r.name.trim(), shortName: r.shortName?.trim() || null })
  }
  // An empty read is not remembered: a transient failure should not hide every club for ten minutes.
  if (clubs.size > 0) memo = { at: now, clubs }
  return clubs
}

/** The club for a numeric soccer team value, or null for anything else (a name stays a name). */
export function soccerClubFor(team: string | null | undefined, clubs: ReadonlyMap<string, SoccerClub>): SoccerClub | null {
  const id = String(team ?? '').trim()
  return /^\d+$/.test(id) ? clubs.get(id) ?? null : null
}

/** True when any of these rows is a soccer player whose team is still a numeric id. */
export function hasNumericSoccerTeam(rows: ReadonlyArray<{ sport?: string | null; team?: string | null }>): boolean {
  return rows.some((r) => String(r.sport ?? '').toUpperCase() === 'SOCCER' && /^\d+$/.test(String(r.team ?? '').trim()))
}
