/**
 * What a Zombie league's invite pages show before you join — the hero and how-it-works on both join routes:
 * `/join?code=` (via `/api/leagues/join/preview`) and `/join/[token]` (via `/api/league/invite`).
 * Every rule number is the engine's (`getZombieRulesForSport`), never a sample value.
 */
import { prisma } from '@/lib/prisma'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { BASH_TRANSFER_SHARE, MAUL_TRANSFER_SHARE } from '@/lib/zombie/winningsShares'
import { zombieThemeForLeague } from '@/lib/zombie/zombieHomeSummary'

export type ZombieJoinPreview = {
  teamCount: number
  joined: number
  inviter: string
  season: number | null
  draftAt: string | null
  backgroundTheme: string
  whispererSecret: boolean
  /** False when only the Whisperer infects (`ZombieLeagueConfig.infectionLossToZombie`). */
  lossToZombieInfects: boolean
  bashingMargin: number
  maulingMargin: number
  reviveSerums: number
  bashShare: number
  maulShare: number
}

/** Null for a league that is not a Zombie league. */
export async function getZombieJoinPreview(leagueId: string): Promise<ZombieJoinPreview | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      leagueVariant: true,
      leagueSize: true,
      userId: true,
      season: true,
      sport: true,
      zombieLeague: { select: { themeLabel: true, teamCount: true, whispererIsPublic: true } },
    },
  })
  if (!league || (league.leagueVariant !== 'zombie' && !league.zombieLeague)) return null
  const [joined, host, draft, rules, config] = await Promise.all([
    prisma.leagueTeam.count({ where: { leagueId, claimedByUserId: { not: null } } }),
    prisma.userProfile.findFirst({ where: { userId: league.userId }, select: { displayName: true } }),
    prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftDateUtc: true } }),
    getZombieRulesForSport(String(league.sport)),
    getZombieLeagueConfig(leagueId).catch(() => null),
  ])
  return {
    teamCount: league.leagueSize || league.zombieLeague?.teamCount || 12,
    joined,
    inviter: host?.displayName || 'the commissioner',
    season: league.season,
    draftAt: draft?.draftDateUtc?.toISOString() ?? null,
    backgroundTheme: zombieThemeForLeague(league.zombieLeague?.themeLabel, leagueId),
    whispererSecret: league.zombieLeague?.whispererIsPublic === false,
    lossToZombieInfects: config?.infectionLossToZombie !== false,
    bashingMargin: rules.bashingThreshold,
    maulingMargin: rules.maulingThreshold,
    reviveSerums: rules.reviveThreshold,
    bashShare: BASH_TRANSFER_SHARE,
    maulShare: MAUL_TRANSFER_SHARE,
  }
}
