import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadCareerGames } from '@/lib/core-app/careerRecords'

/**
 * Your head-to-head record against named AllFantasy managers — the "Rivals"
 * strip on `/core/rankings`, which shows the managers directly above you.
 *
 * ⚠ IDENTITY IS THE PROVIDER ACCOUNT, NOT THE AF ID. A game's opponent is
 * recorded as `u:<platformUserId>` (`careerRecords.ts`), so a rival is matched
 * through every provider account they have — the teams they claimed and the
 * accounts they linked. A rival you met only in a slot nobody claimed cannot be
 * matched and is reported as "never played", which is the honest reading.
 */

export type HeadToHead = { wins: number; losses: number; ties: number; lastSeason: number | null }

export async function headToHeadWith(userId: string, rivalIds: string[]): Promise<Map<string, HeadToHead>> {
  const out = new Map<string, HeadToHead>()
  if (rivalIds.length === 0) return out
  for (const id of rivalIds) out.set(id, { wins: 0, losses: 0, ties: 0, lastSeason: null })

  const [teams, identities, career] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { claimedByUserId: { in: rivalIds }, platformUserId: { not: null } },
        select: { claimedByUserId: true, platformUserId: true },
      })
      .catch(() => []),
    prisma.platformIdentity
      .findMany({ where: { userId: { in: rivalIds } }, select: { userId: true, platformUserId: true } })
      .catch(() => []),
    loadCareerGames(userId).catch(() => null),
  ])
  if (!career) return out

  const rivalByKey = new Map<string, string>()
  for (const t of teams) if (t.claimedByUserId && t.platformUserId) rivalByKey.set(`u:${t.platformUserId}`, t.claimedByUserId)
  for (const i of identities) rivalByKey.set(`u:${i.platformUserId}`, i.userId)

  for (const g of career.games) {
    const rival = g.oppKey ? rivalByKey.get(g.oppKey) : undefined
    if (!rival) continue
    const h = out.get(rival)!
    if (g.result === 'W') h.wins += 1
    else if (g.result === 'L') h.losses += 1
    else h.ties += 1
    h.lastSeason = Math.max(h.lastSeason ?? 0, g.season)
  }
  return out
}
