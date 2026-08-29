import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'

export type LoadedTradeLeague = {
  id: string
  /** The platform's own league id — what the Sleeper endpoints and the IDP board key on. */
  platformLeagueId: string | null
  name: string | null
  sport: LeagueSport
  leagueSize: number | null
  isDynasty: boolean
  leagueType: string | null
  scoring: string | null
  settings: Record<string, unknown> | null
  waiverBudget: number | null
  taxiSlots: number | null
  leagueVariant: string | null
  bestBallMode: boolean | null
  starters: unknown
}

export async function loadLeagueForTrade(args: {
  leagueId: string
  userId: string
  /** When true, skips `assertLeagueMember` (caller already verified membership, e.g. `assertLeagueMemberWithCode`). */
  membershipPreverified?: boolean
}): Promise<LoadedTradeLeague | null> {
  if (!args.membershipPreverified) {
    const access = await assertLeagueMember(args.leagueId, args.userId)
    if (!access.ok) return null
  }

  const row = await prisma.league.findFirst({
    where: { id: args.leagueId },
    select: {
      id: true,
      platformLeagueId: true,
      name: true,
      sport: true,
      leagueSize: true,
      isDynasty: true,
      leagueType: true,
      scoring: true,
      settings: true,
      waiverBudget: true,
      taxiSlots: true,
      leagueVariant: true,
      bestBallMode: true,
      starters: true,
    },
  })
  if (!row) return null
  const settings =
    row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
      ? (row.settings as Record<string, unknown>)
      : null
  return {
    id: row.id,
    platformLeagueId: row.platformLeagueId,
    name: row.name,
    sport: row.sport,
    leagueSize: row.leagueSize,
    isDynasty: row.isDynasty,
    leagueType: row.leagueType,
    scoring: row.scoring,
    settings,
    waiverBudget: row.waiverBudget,
    taxiSlots: row.taxiSlots,
    leagueVariant: row.leagueVariant,
    bestBallMode: row.bestBallMode,
    starters: row.starters,
  }
}
