import { prisma } from '@/lib/prisma'

export type FutureDraftConfig = {
  format: string
  rookieDraftIncludes: string[]
  devyDraftIncludes: string[]
  combinedIncludes: string[]
  notes: string[]
}

type DraftPool = {
  draftType: 'rookie' | 'devy' | 'combined'
  season: number
  leagueId: string
  rookieCandidates: { playerId: string; label: string; sport: string }[]
  devyCandidates: { playerId: string; label: string; sport: string }[]
  ownedDevyPlayerIds: string[]
}

/**
 * Builds the annual draft pool. Wires to `Player` / college feeds when present; otherwise returns structural metadata only.
 */
export async function buildAnnualDraftPool(
  leagueId: string,
  season: number,
  draftType: 'rookie' | 'devy' | 'combined',
): Promise<DraftPool> {
  const owned = await prisma.devyDevySlot.findMany({
    where: { leagueId },
    select: { playerId: true },
  })
  const ownedDevyPlayerIds = owned.map(o => o.playerId)

  const rookieCandidates: DraftPool['rookieCandidates'] = []
  const devyCandidates: DraftPool['devyCandidates'] = []

  if (draftType !== 'devy') {
    const rookies = await prisma.player.findMany({
      where: { league: 'NFL', active: true },
      take: 400,
      select: { id: true, name: true, sport: true },
    })
    for (const p of rookies) {
      rookieCandidates.push({
        playerId: p.id,
        label: p.name,
        sport: p.sport,
      })
    }
  }

  if (draftType !== 'rookie') {
    const devies = await prisma.player.findMany({
      where: { devyEligible: true, graduatedToNFL: false, active: true },
      take: 500,
      select: { id: true, name: true, sport: true },
    })
    for (const p of devies) {
      if (ownedDevyPlayerIds.includes(p.id)) continue
      devyCandidates.push({
        playerId: p.id,
        label: p.name,
        sport: p.sport,
      })
    }
  }

  return {
    draftType,
    season,
    leagueId,
    rookieCandidates,
    devyCandidates,
    ownedDevyPlayerIds,
  }
}

