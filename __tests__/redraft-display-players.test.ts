import { describe, expect, it } from 'vitest'
import {
  buildDisplayPlayerMap,
  displayPlayerFromUnifiedRow,
  resolveDisplayPlayer,
} from '@/lib/player-data/adapters/redraftDisplayPlayers'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

function sampleWire(overrides: Partial<UnifiedPlayerWireDto> = {}): UnifiedPlayerWireDto {
  return {
    id: 'p1',
    name: 'Player One',
    position: 'WR',
    team: 'BUF',
    sport: 'NFL',
    headshotUrl: 'https://img.example/headshot.png',
    imageUrl: 'https://img.example/image.png',
    teamLogoUrl: 'https://img.example/logo.png',
    injuryStatus: 'Questionable',
    fantasyPointsPerGame: 14.2,
    projectedPoints: 16.8,
    adp: 52.1,
    aiAdp: null,
    aiAdpSampleSize: null,
    collegeClass: '',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: false,
    nflRookieSource: null,
    lowConfidence: false,
    profileSource: 'sports_players',
    statsSource: 'rolling_insights',
    projectionsSource: 'sports_players.projections',
    normalizedStats: { receiving_yards: 900 },
    normalizedProjections: { fantasy_points: 16.8 },
    product: {
      unified: {} as UnifiedPlayerWireDto['product']['unified'],
      yearsExp: 3,
      isRookie: false,
      byeWeek: 12,
    },
    ...overrides,
  }
}

describe('redraftDisplayPlayers adapter', () => {
  it('maps a normalized wire row into the shared display shape', () => {
    const row = displayPlayerFromUnifiedRow(sampleWire())
    // `imageUrl` resolves through the same canonical/metadata headshot pipeline
    // as `headshotUrl` (consumers like PlayerPanel.tsx treat it as a headshot
    // fallback alias, not an independent raw field) — it is NOT a pass-through
    // of the wire row's own `imageUrl`.
    expect(row).toMatchObject({
      id: 'p1',
      name: 'Player One',
      position: 'WR',
      team: 'BUF',
      headshotUrl: 'https://img.example/headshot.png',
      imageUrl: 'https://img.example/headshot.png',
      teamLogoUrl: 'https://img.example/logo.png',
      injuryStatus: 'Questionable',
      projectedPoints: 16.8,
      fantasyPointsPerGame: 14.2,
      years_exp: 3,
    })
  })

  it('merges normalized rows over the fallback Sleeper map while preserving provider ids', () => {
    const merged = buildDisplayPlayerMap(
      {
        p1: {
          id: 'p1',
          name: 'Sleeper Name',
          position: 'WR',
          team: 'BUF',
          espn_id: '123',
        },
      },
      [sampleWire({ name: 'Normalized Name' })],
    )

    expect(merged.p1).toMatchObject({
      id: 'p1',
      name: 'Normalized Name',
      espn_id: '123',
      headshotUrl: 'https://img.example/headshot.png',
      teamLogoUrl: 'https://img.example/logo.png',
    })
  })

  it('falls back to a stable placeholder shape when the player id is missing from the map', () => {
    expect(resolveDisplayPlayer('p9', {})).toMatchObject({
      id: 'p9',
      name: 'Player p9',
      position: '',
      team: '',
    })
  })
})
