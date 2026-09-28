/**
 * Resolve headshots for Start A vs B UI (best-effort DB lookup by name + sport).
 */

import { toImageUrl } from '@/lib/media/imageUrl'
import { prisma } from '@/lib/prisma'
import { buildPlayerMedia } from '@/lib/player-media'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

const SLEEPER_THUMB = 'https://sleepercdn.com/content/nfl/players/thumb'

function sleeperThumb(sleeperId: string): string {
  return `${SLEEPER_THUMB}/${sleeperId}.jpg`
}

async function lookupHeadshot(args: {
  sport: string
  name: string
  team: string | null
}): Promise<{ headshotUrl: string | null; teamLogoUrl: string | null }> {
  const sport = normalizeToSupportedSport(args.sport)
  const sportKey = sport.toUpperCase()

  try {
    const withTeam =
      args.team && args.team.trim().length > 0
        ? await prisma.sportsPlayer.findFirst({
            where: {
              sport: sportKey,
              name: { equals: args.name.trim(), mode: 'insensitive' },
              team: { equals: args.team.trim(), mode: 'insensitive' },
            },
            select: { imageUrl: true, sleeperId: true, team: true },
            orderBy: { fetchedAt: 'desc' },
          })
        : null

    const row =
      withTeam ??
      (await prisma.sportsPlayer.findFirst({
        where: {
          sport: sportKey,
          name: { equals: args.name.trim(), mode: 'insensitive' },
        },
        select: { imageUrl: true, sleeperId: true, team: true },
        orderBy: { fetchedAt: 'desc' },
      }))

    const headshotUrl =
      toImageUrl(row?.imageUrl) ||
      (row?.sleeperId ? sleeperThumb(row.sleeperId) : null) ||
      null

    const media = buildPlayerMedia(row?.sleeperId ?? null, row?.team ?? args.team, sport)
    return {
      headshotUrl,
      teamLogoUrl: media.teamLogoUrl,
    }
  } catch {
    const media = buildPlayerMedia(null, args.team, sport)
    return { headshotUrl: null, teamLogoUrl: media.teamLogoUrl }
  }
}

export async function resolveStartVsDisplayMedia(args: {
  sport: string
  playerA: { name: string; team: string | null }
  playerB: { name: string; team: string | null }
}): Promise<{
  playerA: { headshotUrl: string | null; teamLogoUrl: string | null }
  playerB: { headshotUrl: string | null; teamLogoUrl: string | null }
}> {
  const [playerA, playerB] = await Promise.all([
    lookupHeadshot({ sport: args.sport, name: args.playerA.name, team: args.playerA.team }),
    lookupHeadshot({ sport: args.sport, name: args.playerB.name, team: args.playerB.team }),
  ])
  return { playerA, playerB }
}
