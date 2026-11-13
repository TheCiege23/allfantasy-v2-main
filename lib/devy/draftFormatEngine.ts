import { prisma } from '@/lib/prisma'
import { DEFAULT_SPORT, type SupportedSport } from '@/lib/sport-scope'

export type DraftPoolConfig = {
  poolId: string
  label: string
  description: string
  /** What player universes feed this pool (logical labels). */
  includes: string[]
  sport: string
}

export type FutureDraftConfig = {
  format: string
  rookieDraftIncludes: string[]
  devyDraftIncludes: string[]
  combinedIncludes: string[]
  notes: string[]
}

export type DraftPool = {
  draftType: 'rookie' | 'devy' | 'combined'
  season: number
  leagueId: string
  rookieCandidates: { playerId: string; label: string; sport: string }[]
  devyCandidates: { playerId: string; label: string; sport: string }[]
  ownedDevyPlayerIds: string[]
}

/** Startup draft pool layout — format is locked at league creation. */
export function getStartupDraftPoolConfig(format: string, sport: string): DraftPoolConfig[] {
  const s = (sport || DEFAULT_SPORT) as SupportedSport
  if (format === 'combined') {
    return [
      {
        poolId: 'combined_all',
        label: 'Combined startup',
        description: 'NFL veterans, NFL rookies, and devy prospects in one draft order.',
        includes: ['nfl_veteran', 'nfl_rookie', 'devy'],
        sport: s,
      },
    ]
  }
  if (format === 'split_vets_first') {
    return [
      {
        poolId: 'vets_rookies',
        label: 'NFL veterans + current rookies',
        description: 'Established NFL talent and rookie class first.',
        includes: ['nfl_veteran', 'nfl_rookie'],
        sport: s,
      },
      {
        poolId: 'devy_only',
        label: 'Devy draft',
        description: 'College / developmental players after the NFL pool completes.',
        includes: ['devy'],
        sport: s,
      },
    ]
  }
  if (format === 'split_devy_first') {
    return [
      {
        poolId: 'vets_only',
        label: 'NFL veterans',
        description: 'Veterans only — youth held for the second draft.',
        includes: ['nfl_veteran'],
        sport: s,
      },
      {
        poolId: 'rookies_devy',
        label: 'Rookies + devy',
        description: 'NFL rookie class and devy prospects together.',
        includes: ['nfl_rookie', 'devy'],
        sport: s,
      },
    ]
  }
  return getStartupDraftPoolConfig('combined', s)
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

