import { describe, expect, it } from 'vitest'
import { mapNormalizedDraftEntryToPlayerEntry } from '@/lib/player-data/adapters/draftRoomPlayerAdapter'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import { buildAiAdpLookupMaps } from '@/lib/draft-room/ai-adp-lookup'

function minimalEntry(overrides: Partial<NormalizedDraftEntry> = {}): NormalizedDraftEntry {
  return {
    display: {
      playerId: 'p1',
      displayName: 'Test Player',
      sport: 'NFL',
      assets: { headshotUrl: null, teamLogoUrl: null },
      team: null,
      stats: {
        primaryStatLabel: null,
        primaryStatValue: null,
        secondaryStatLabel: null,
        secondaryStatValue: null,
        adp: 12,
        byeWeek: 7,
        fantasyPointsPerGame: null,
        lifetimeValue: null,
        rollingInsightsSupplemental: null,
      },
      metadata: {
        position: 'RB',
        teamAbbreviation: 'DAL',
        byeWeek: 7,
        injuryStatus: null,
        collegeOrPipeline: null,
        classYearLabel: null,
        draftGrade: null,
        projectedLandingSpot: null,
      },
    },
    name: 'Test Player',
    position: 'RB',
    team: 'DAL',
    adp: 12,
    byeWeek: 7,
    aiAdp: 14,
    aiAdpSampleSize: 100,
    sport: 'NFL',
    ...overrides,
  } as NormalizedDraftEntry
}

describe('draftRoomPlayerAdapter', () => {
  it('preserves ADP vs AI ADP when AllFantasy ADP flag is on', () => {
    const e = minimalEntry({ adp: 10, aiAdp: 22 })
    const maps = buildAiAdpLookupMaps([])
    const row = mapNormalizedDraftEntryToPlayerEntry(e, {
      draftUISettings: { aiAdpEnabled: true },
      useAllFantasyAdp: true,
      aiAdpLookupMaps: maps,
    })
    expect(row.adp).toBe(10)
    expect(row.aiAdp).toBe(22)
  })

  it('adds unifiedProductView when includeUnifiedProduct is true', () => {
    const e = minimalEntry()
    const maps = buildAiAdpLookupMaps([])
    const row = mapNormalizedDraftEntryToPlayerEntry(e, {
      useAllFantasyAdp: true,
      aiAdpLookupMaps: maps,
      includeUnifiedProduct: true,
    })
    expect(row.unifiedProductView?.unified.playerId).toBe('p1')
  })

  it('does not attach diagnostics by default', () => {
    const e = minimalEntry()
    const maps = buildAiAdpLookupMaps([])
    const row = mapNormalizedDraftEntryToPlayerEntry(e, {
      useAllFantasyAdp: true,
      aiAdpLookupMaps: maps,
      includeProviderFallbackDiagnostics: false,
    })
    expect(row.providerFallbackDiagnostics).toBeUndefined()
  })
})
