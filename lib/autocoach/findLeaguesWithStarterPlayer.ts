import 'server-only'

import type { LeagueSport } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { mayBeSleeperId } from '@/lib/player-identity/externalIdNamespace'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

/**
 * Leagues (with AutoCoach-enabled users) where `externalPlayerId` appears in the user's starting lineup.
 */
export async function findLeagueIdsWithPlayerAsStarter(sport: string, externalPlayerId: string): Promise<string[]> {
  const sk = sport.toUpperCase() as LeagueSport
  const settings = await prisma.autoCoachSetting.findMany({
    where: {
      enabled: true,
      blockedByCommissioner: false,
      league: { sport: sk, autoCoachEnabled: true },
    },
    select: { leagueId: true, userId: true },
  })
  if (settings.length === 0) return []

  const rosters = await prisma.roster.findMany({
    where: {
      OR: settings.map((s) => ({ leagueId: s.leagueId, platformUserId: s.userId })),
    },
    select: { leagueId: true, playerData: true },
  })

  /*
   * 🛑 `externalPlayerId` IS A PROVIDER-SPACE ID (PlayerStatusAggregator's invariant) AND STARTER
   * IDS ARE LEAGUE IDS — Sleeper ids in NFL. Compared directly, a Rolling Insights status for its
   * player 8394 (Rome Odunze) re-ran every league STARTING Sleeper 8394 (Percy Butler) and missed
   * Odunze's. Translate to the row's Sleeper id; keep the provider id only where it cannot be a
   * Sleeper id (another sport's native roster holds RI ids, and there it is the right key).
   */
  const resolved = await prisma.sportsPlayer.findFirst({
    where: { sport: sk, externalId: externalPlayerId, source: { not: 'sleeper' } },
    select: { sleeperId: true },
  })
  const keys = new Set<string>()
  if (resolved?.sleeperId) keys.add(resolved.sleeperId)
  if (!mayBeSleeperId(externalPlayerId, sk)) keys.add(externalPlayerId)
  if (keys.size === 0) return []

  const leagueIds = new Set<string>()
  for (const r of rosters) {
    try {
      const sections = getNormalizedLineupSections(r.playerData)
      if (sections.starters.some((st) => keys.has(String(st.id)))) {
        leagueIds.add(r.leagueId)
      }
    } catch {
      continue
    }
  }
  return [...leagueIds]
}
