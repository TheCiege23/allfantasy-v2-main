/**
 * Identity resolution for sports_players-backed draft enrichment — strict vs loose,
 * sport isolation, NFL team aliases. Maps mirror `loadSportsPlayerRecordMapsForDraftPool`
 * loose-bucket rules without hitting Prisma.
 */

import { describe, expect, it } from 'vitest'
import type { LeagueSport } from '@prisma/client'
import {
  buildLoosePlayerKey,
  buildStrictPlayerKey,
} from '@/lib/player-identity/playerIdentityResolution'
import {
  lookupSportsPlayerRecordAugmentDetailed,
  type SportsPlayerRecordDraftAugment,
  type SportsPlayerRecordDraftMaps,
} from '@/lib/draft-room/sportsPlayerRecordDraftEnrichment'

const aug = (n: number): SportsPlayerRecordDraftAugment => ({
  fantasyPointsPerGame: n,
  adp: n,
  headshotUrl: null,
  rookieHint: null,
})

function buildMapsForSport(
  sport: string,
  records: Array<{ id: string; name: string; position: string; team: string }>,
): SportsPlayerRecordDraftMaps {
  const byRecordId = new Map<string, SportsPlayerRecordDraftAugment>()
  const strict = new Map<string, SportsPlayerRecordDraftAugment>()
  const looseGroups = new Map<string, Map<string, SportsPlayerRecordDraftAugment>>()

  for (const rec of records) {
    const num = Number.parseInt(rec.id.replace(/\D/g, '') || '1', 10)
    const a = aug(Number.isFinite(num) ? (num % 90) + 1 : 7)
    byRecordId.set(rec.id, a)
    const sk = buildStrictPlayerKey({
      name: rec.name,
      position: rec.position,
      team: rec.team,
      sport,
    })
    strict.set(sk, a)
    const lk = buildLoosePlayerKey({
      name: rec.name,
      position: rec.position,
      sport,
    })
    const bucket = looseGroups.get(lk) ?? new Map<string, SportsPlayerRecordDraftAugment>()
    bucket.set(sk, a)
    looseGroups.set(lk, bucket)
  }

  const loose = new Map<string, SportsPlayerRecordDraftAugment>()
  for (const [lk, bucket] of looseGroups) {
    if (bucket.size === 1) loose.set(lk, [...bucket.values()][0]!)
  }

  return { byRecordId, strict, loose }
}

describe('lookupSportsPlayerRecordAugmentDetailed', () => {
  it('duplicate names on different real teams: loose map empty when ambiguous; rostered pool row never uses loose', () => {
    const sport = 'NFL'
    const maps = buildMapsForSport(sport, [
      { id: 'spr1', name: 'Tyler Johnson', position: 'WR', team: 'TB' },
      { id: 'spr2', name: 'Tyler Johnson', position: 'WR', team: 'LA' },
    ])
    expect(maps.loose.size).toBe(0)

    const poolFa = lookupSportsPlayerRecordAugmentDetailed(
      maps,
      sport as LeagueSport,
      'Tyler Johnson',
      'WR',
      'FA',
      'wrong-id',
    )
    expect(poolFa.augment).toBeNull()
    expect(poolFa.meta.matchType).toBe('none')

    const poolStrict = lookupSportsPlayerRecordAugmentDetailed(
      maps,
      sport as LeagueSport,
      'Tyler Johnson',
      'WR',
      'TB',
      null,
    )
    expect(poolStrict.augment?.fantasyPointsPerGame).toBeDefined()
    expect(poolStrict.meta.matchType).toBe('strict')
    expect(poolStrict.meta.confidence).toBe(0.9)
  })

  it('same name+position unique in DB batch + FA pool row: loose fallback attaches at 0.5 confidence', () => {
    const sport = 'NFL'
    const maps = buildMapsForSport(sport, [
      { id: 'spr-only', name: 'Solo Waivers', position: 'RB', team: 'KC' },
    ])
    const r = lookupSportsPlayerRecordAugmentDetailed(
      maps,
      sport as LeagueSport,
      'Solo Waivers',
      'RB',
      null,
      null,
    )
    expect(r.augment).not.toBeNull()
    expect(r.meta.matchType).toBe('loose')
    expect(r.meta.confidence).toBe(0.5)
  })

  it('real team on pool row: loose branch skipped even if loose map has a candidate', () => {
    const sport = 'NFL'
    const maps = buildMapsForSport(sport, [
      { id: 'one', name: 'Only Name', position: 'TE', team: 'KC' },
    ])
    expect(maps.loose.size).toBe(1)
    const r = lookupSportsPlayerRecordAugmentDetailed(
      maps,
      sport as LeagueSport,
      'Only Name',
      'TE',
      'DEN',
      null,
    )
    expect(r.augment).toBeNull()
    expect(r.meta.matchType).toBe('none')
  })

  it('ID match: matchType id and confidence 1.0', () => {
    const sport = 'NBA'
    const maps = buildMapsForSport(sport, [
      { id: 'nba-rec-1', name: 'Kevin Durant', position: 'SF', team: 'PHX' },
    ])
    const r = lookupSportsPlayerRecordAugmentDetailed(
      maps,
      sport as LeagueSport,
      'Kevin Durant',
      'SF',
      'PHX',
      'nba-rec-1',
    )
    expect(r.meta.matchType).toBe('id')
    expect(r.meta.confidence).toBe(1)
    expect(r.augment?.fantasyPointsPerGame).toBeDefined()
  })

  it('strict match: matchType strict and confidence 0.9', () => {
    const sport = 'NHL'
    const maps = buildMapsForSport(sport, [
      { id: 'nhl-1', name: 'Sidney Crosby', position: 'C', team: 'PIT' },
    ])
    const r = lookupSportsPlayerRecordAugmentDetailed(
      maps,
      sport as LeagueSport,
      'Sidney Crosby',
      'C',
      'PIT',
      null,
    )
    expect(r.meta.matchType).toBe('strict')
    expect(r.meta.confidence).toBe(0.9)
  })

  it('ID miss but strict hit: enrichment attaches and strictHitAfterIdMiss is true', () => {
    const sport = 'MLB'
    const maps = buildMapsForSport(sport, [
      { id: 'mlb-canon', name: 'Shohei Ohtani', position: 'UTIL', team: 'LAD' },
    ])
    const r = lookupSportsPlayerRecordAugmentDetailed(
      maps,
      sport as LeagueSport,
      'Shohei Ohtani',
      'UTIL',
      'LAD',
      'stale-external-id',
    )
    expect(r.augment).not.toBeNull()
    expect(r.meta.matchType).toBe('strict')
    expect(r.meta.strictHitAfterIdMiss).toBe(true)
    expect(r.meta.idLookupAttempted).toBe(true)
    expect(r.meta.idLookupHit).toBe(false)
  })

  it('NFL team alias normalization: JAC vs JAX and WAS vs WSH resolve to same strict key', () => {
    const sport = 'NFL'
    const maps = buildMapsForSport(sport, [{ id: 'x', name: 'Travis Etienne', position: 'RB', team: 'JAX' }])
    const a = lookupSportsPlayerRecordAugmentDetailed(
      maps,
      sport as LeagueSport,
      'Travis Etienne',
      'RB',
      'JAC',
      null,
    )
    expect(a.meta.matchType).toBe('strict')
    const b = lookupSportsPlayerRecordAugmentDetailed(
      maps,
      sport as LeagueSport,
      'Travis Etienne',
      'RB',
      'WSH',
      null,
    )
    const mapsWas = buildMapsForSport(sport, [{ id: 'y', name: 'Chris Rodriguez', position: 'RB', team: 'WAS' }])
    const w = lookupSportsPlayerRecordAugmentDetailed(
      mapsWas,
      sport as LeagueSport,
      'Chris Rodriguez',
      'RB',
      'WSH',
      null,
    )
    expect(w.meta.matchType).toBe('strict')
  })

  it('sport isolation: same display name in NFL and NBA never cross-match strict keys', () => {
    const name = 'Chris Smith'
    const NFLMaps = buildMapsForSport('NFL', [{ id: 'nfl', name, position: 'WR', team: 'DAL' }])
    const NBAMaps = buildMapsForSport('NBA', [{ id: 'nba', name, position: 'SF', team: 'DAL' }])

    const nflSk = buildStrictPlayerKey({ name, position: 'WR', team: 'DAL', sport: 'NFL' })
    const nbaSk = buildStrictPlayerKey({ name, position: 'SF', team: 'DAL', sport: 'NBA' })
    expect(nflSk).not.toBe(nbaSk)

    const wrongSportLookup = lookupSportsPlayerRecordAugmentDetailed(
      NBAMaps,
      'NFL' as LeagueSport,
      name,
      'WR',
      'DAL',
      'nfl',
    )
    expect(wrongSportLookup.augment).toBeNull()
  })
})
