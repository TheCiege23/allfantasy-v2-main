import type { C2CPlayerState } from '@prisma/client'

export type DraftPoolConfig = {
  id: string
  label: string
  side: 'campus' | 'canton' | 'combined'
  description: string
}

export type AnnualDraftPool = {
  combinedPoolSize: number
  campusOnlySize: number
  cantonOnlySize: number
  notes: string
}

export type C2CDraftRoom = {
  leagueId: string
  draftType: string
  season: number
  format: string
  sportPair: string
  pools: DraftPoolConfig[]
  pickInventoryNote: string
}

/** Draft pool layout per startup/future format. */
export function getDraftPoolConfig(format: string, sportPair: string): DraftPoolConfig[] {
  const sp = sportPair.toUpperCase()
  const isNfl = sp.includes('NFL') || sp === 'NFL_CFB'
  const campusLabel = isNfl ? 'NCAA Football' : 'NCAA Basketball'
  const cantonLabel = isNfl ? 'NFL' : 'NBA'

  const f = format.toLowerCase()
  if (f === 'combined' || f === 'combined_total') {
    return [
      {
        id: 'combined',
        label: 'Combined board',
        side: 'combined',
        description: `Single draft: ${campusLabel} + ${cantonLabel} eligibles in one player pool.`,
      },
    ]
  }
  if (f.includes('split') || f === 'split_campus_canton') {
    return [
      { id: 'campus', label: `${campusLabel} draft`, side: 'campus', description: 'College players only.' },
      { id: 'canton', label: `${cantonLabel} draft`, side: 'canton', description: 'Pro players only.' },
    ]
  }
  if (f.includes('canton_first')) {
    return [
      { id: 'canton_a', label: `${cantonLabel} first`, side: 'canton', description: 'Pro draft round 1.' },
      { id: 'campus_b', label: `${campusLabel} second`, side: 'campus', description: 'College draft follows.' },
    ]
  }
  if (f.includes('campus_first')) {
    return [
      { id: 'campus_a', label: `${campusLabel} first`, side: 'campus', description: 'College draft round 1.' },
      { id: 'canton_b', label: `${cantonLabel} second`, side: 'canton', description: 'Pro draft follows.' },
    ]
  }
  return getDraftPoolConfig('split_campus_canton', sportPair)
}

export function getAnnualDraftPool(format: string, sportPair: string, ownedPlayers: C2CPlayerState[]): AnnualDraftPool {
  const owned = new Set(ownedPlayers.map((p) => p.playerId))
  const f = format.toLowerCase()
  const baseNote =
    owned.size > 0
      ? `${owned.size} player ids excluded as already rostered (transitioning rights).`
      : 'No rostered players to exclude.'
  if (f === 'combined' || f === 'combined_total') {
    return {
      combinedPoolSize: 500,
      campusOnlySize: 0,
      cantonOnlySize: 0,
      notes: `Combined rookie/FA pool. ${baseNote}`,
    }
  }
  return {
    combinedPoolSize: 0,
    campusOnlySize: 300,
    cantonOnlySize: 224,
    notes: `Separate campus and canton boards. ${baseNote}`,
  }
}

/** Placeholder draft room config — wire to live draft session when C2C draft UI lands. */
export async function buildC2CDraftRoom(leagueId: string, draftType: string, season: number): Promise<C2CDraftRoom> {
  const { prisma } = await import('@/lib/prisma')
  const { loadC2CLeagueSettings } = await import('@/lib/c2c/c2cLeagueSettings')
  const cfg = await loadC2CLeagueSettings(leagueId)
  const sportPair = cfg?.sportPair ?? 'NFL_CFB'
  const format = cfg?.futureDraftFormat ?? cfg?.startupDraftFormat ?? 'combined'
  return {
    leagueId,
    draftType,
    season,
    format,
    sportPair,
    pools: getDraftPoolConfig(format, sportPair),
    pickInventoryNote: 'Pick rows stored in c2c_draft_picks — populate on draft open.',
  }
}
