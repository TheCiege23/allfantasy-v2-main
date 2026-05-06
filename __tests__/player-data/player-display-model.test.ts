import { describe, expect, it } from 'vitest'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import { buildUnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import type { PoolPlayerRecord } from '@/lib/sport-teams/types'
import {
  normalizePoolRowToUnified,
  poolPlayerRecordToRawDraftLike,
} from '@/lib/player-data/normalizeProviderPlayer'
import { mapSoccerPositionGroup } from '@/lib/player-data/sportSpecificPlayerFields'

function nflEntry(overrides: Partial<NormalizedDraftEntry> = {}): NormalizedDraftEntry {
  const base = normalizeDraftPlayer(
    {
      full_name: 'Rookie Runner',
      position: 'RB',
      team: 'KC',
      playerId: 'sleeper-1',
      yearsExp: 0,
      rookieYearsExpSource: 'sleeper_live',
    },
    'NFL',
  )
  return { ...base, ...overrides }
}

describe('UnifiedPlayerProductView', () => {
  it('normalizes identity + keeps ADP separate from AI ADP', () => {
    const entry = normalizeDraftPlayer(
      {
        full_name: 'Star Wr',
        position: 'WR',
        team: 'DAL',
        playerId: 'wr-1',
        adp: 24,
      },
      'NFL',
    )
    const ai = { ...entry, aiAdp: 18, aiAdpSampleSize: 120 }
    const u = buildUnifiedPlayerProductView(ai).unified
    expect(u.playerId).toBeTruthy()
    expect(u.adp).toBe(24)
    expect(u.aiAdp).toBe(18)
    expect(u.aiAdpSampleSize).toBe(120)
  })

  it('keeps provider rookie metadata via NFL policy (Sleeper years_exp)', () => {
    const base = nflEntry()
    /** Strip computed rookie flag so policy resolves from years_exp (normalizeDraftPlayer sets both). */
    const entry = { ...base, isRookie: undefined }
    const u = buildUnifiedPlayerProductView(entry).unified
    expect(u.nflRookie?.isRookie).toBe(true)
    expect(u.nflRookie?.source).toBe('sleeper_years_exp')
  })

  it('unknown rookie signal yields null isRookie, not false', () => {
    const entry = normalizeDraftPlayer(
      {
        full_name: 'Veteran X',
        position: 'QB',
        team: 'BUF',
        playerId: 'qb-x',
      },
      'NFL',
    )
    const u = buildUnifiedPlayerProductView(entry).unified
    expect(u.nflRookie?.isRookie).not.toBe(false)
    expect(u.nflRookie?.source === 'unknown' || u.nflRookie?.isRookie === null).toBe(true)
  })

  it('NCAAF preserves college class labels and does not treat NFL years_exp', () => {
    const entry = normalizeDraftPlayer(
      {
        full_name: 'College Athlete',
        position: 'QB',
        team: 'OSU',
        playerId: 'cfb-1',
        classYearLabel: 'So',
        yearsExp: 3,
      },
      'NCAAF',
    )
    const u = buildUnifiedPlayerProductView(entry).unified
    expect(u.collegeClass).toBe('sophomore')
    expect(u.yearsExperience).toBe(null)
  })

  it('SOCCER maps position groups and preserves league hint on pool rows', () => {
    const row: PoolPlayerRecord = {
      player_id: 'soc-1',
      sport_type: 'SOCCER',
      team_id: 't1',
      team_abbreviation: 'ARS',
      team: 'ARS',
      full_name: 'Keeper One',
      position: 'GKP',
      status: null,
      injury_status: null,
      external_source_id: null,
      metadata: { soccerLeague: 'EPL', birthDateRaw: '1998-01-02' },
    }
    const raw = poolPlayerRecordToRawDraftLike(row)
    expect(raw.metadata).toMatchObject({ birthDateRaw: '1998-01-02' })
    const u = normalizePoolRowToUnified(row, 'SOCCER').unified
    expect(mapSoccerPositionGroup('GKP')).toBe('Goalkeeper')
    expect(u.soccerPositionGroup).toBe('Goalkeeper')
    expect(u.soccerLeague).toBe('EPL')
    expect(u.birthDateRaw).toBe('1998-01-02')
  })

  it('does not mix duplicate identities across sports when ids differ', () => {
    const nfl = buildUnifiedPlayerProductView(nflEntry()).unified
    const cfb = buildUnifiedPlayerProductView(
      normalizeDraftPlayer({ full_name: 'Same Name', position: 'RB', team: 'MIA', playerId: 'a' }, 'NCAAF'),
    ).unified
    expect(nfl.playerId).not.toBe(cfb.playerId)
    expect(nfl.sport).not.toBe(cfb.sport)
  })
})
