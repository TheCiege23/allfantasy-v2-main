import { describe, expect, it } from 'vitest'
import {
  NFL_REDRAFT_PROVIDER_EVIDENCE_PACKET_MODEL_VERSION,
  type NflRedraftEvidenceSurface,
  type NflRedraftEvidenceType,
  type NflRedraftProviderEvidencePacket,
} from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import {
  buildBasicRuntimeFactsSummary,
  buildCommissionerDigestServiceSummary,
  buildDraftPrepServiceSummary,
  buildManagerBriefServiceSummary,
  buildMatchupPrepServiceSummary,
  buildNflRedraftPremiumServiceSummary,
  buildTradeReviewServiceSummary,
  buildWaiverReportServiceSummary,
  buildWarRoomServiceSummary,
  canAccessNflRedraftPremiumService,
  resolveNflRedraftPremiumServiceRequiredTier,
  type NflRedraftPremiumServiceSummary,
  type NflRedraftPremiumTier,
} from '@/lib/redraft-premium'

const INGESTED = '2026-09-13T18:16:00.000Z'

const SURFACES_BY_TYPE: Record<NflRedraftEvidenceType, NflRedraftEvidenceSurface[]> = {
  player_identity: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  player_metadata_media: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  projection: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  injury: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  news: ['draft', 'waiver', 'trade', 'team', 'player_card'],
  ranking_adp: ['draft', 'mock_draft', 'waiver', 'trade', 'player_card'],
  schedule_game_context: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  weather: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  live_stats: ['roster', 'matchup', 'team', 'player_card', 'live_scoring'],
  fantasy_scoring: ['matchup', 'team', 'player_card', 'live_scoring', 'standings'],
  stat_correction: ['matchup', 'live_scoring', 'standings', 'audit'],
  roster_context: ['roster', 'team', 'player_card'],
  matchup_context: ['matchup', 'team', 'player_card'],
  waiver_context: ['waiver', 'player_card'],
  trade_context: ['trade', 'player_card'],
  draft_context: ['draft', 'mock_draft', 'player_card'],
}

function packet(
  evidenceType: NflRedraftEvidenceType,
  overrides: Partial<NflRedraftProviderEvidencePacket> = {},
): NflRedraftProviderEvidencePacket {
  const stale = overrides.stale ?? overrides.freshnessStatus === 'stale'
  const missing = overrides.missing ?? overrides.freshnessStatus === 'missing'
  const fallback = overrides.fallback ?? false
  return {
    modelVersion: NFL_REDRAFT_PROVIDER_EVIDENCE_PACKET_MODEL_VERSION,
    evidenceId: `packet-${evidenceType}-${overrides.canonicalPlayerId ?? 'player-g49a'}`,
    evidenceType,
    canonicalLeagueId: 'league-g49a',
    canonicalTeamId: 'team-g49a',
    canonicalPlayerId: 'player-g49a',
    canonicalGameId: evidenceType.includes('weather') || evidenceType.includes('scoring') ? 'game-g49a' : null,
    canonicalMatchupId: evidenceType.includes('matchup') || evidenceType === 'fantasy_scoring' ? 'matchup-g49a' : null,
    sourceProvider: 'allfantasy',
    providerCapabilityDomain: 'player_metadata',
    sourceTimestampIso: '2026-09-13T18:10:00.000Z',
    ingestedTimestampIso: INGESTED,
    freshnessStatus: 'available',
    stale,
    missing,
    fallback,
    confidenceLevel: missing ? 'unknown' : fallback || stale ? 'low' : 'high',
    affectedSurfaces: SURFACES_BY_TYPE[evidenceType],
    canonicalFieldNamesIncluded: [evidenceType],
    facts: { canonicalOnly: true, field: evidenceType },
    errorMetadata: null,
    retryRateLimitMetadata: null,
    internalDebugReference: null,
    ...overrides,
  }
}

function evidencePackets(): NflRedraftProviderEvidencePacket[] {
  return [
    packet('player_identity', { providerCapabilityDomain: 'player_metadata' }),
    packet('player_metadata_media', { providerCapabilityDomain: 'headshot' }),
    packet('projection', { sourceProvider: 'sportsdataio', providerCapabilityDomain: 'projection' }),
    packet('injury', { sourceProvider: 'sportsdataio', providerCapabilityDomain: 'injury' }),
    packet('news', { sourceProvider: 'sportsdataio', providerCapabilityDomain: 'news' }),
    packet('ranking_adp', { sourceProvider: 'sleeper', providerCapabilityDomain: 'mock_draft' }),
    packet('schedule_game_context', { sourceProvider: 'thesportsdb', providerCapabilityDomain: 'schedule' }),
    packet('weather', {
      sourceProvider: 'openweather',
      providerCapabilityDomain: 'weather',
      canonicalGameId: 'game-g49a',
      freshnessStatus: 'stale',
      stale: true,
      fallback: true,
    }),
    packet('live_stats', {
      sourceProvider: 'sportsdataio',
      providerCapabilityDomain: 'live_score',
      canonicalGameId: 'game-g49a',
    }),
    packet('fantasy_scoring', {
      sourceProvider: 'sportsdataio',
      providerCapabilityDomain: 'live_score',
      canonicalGameId: 'game-g49a',
      canonicalMatchupId: 'matchup-g49a',
    }),
    packet('stat_correction', {
      sourceProvider: 'sportsdataio',
      providerCapabilityDomain: 'live_score',
      canonicalGameId: 'game-g49a',
      canonicalMatchupId: 'matchup-g49a',
    }),
    packet('roster_context', { canonicalTeamId: 'team-g49a' }),
    packet('matchup_context', { canonicalMatchupId: 'matchup-g49a' }),
    packet('waiver_context', {
      freshnessStatus: 'missing',
      missing: true,
      fallback: true,
      facts: { canonicalOnly: true, waiverContextUnavailable: true },
    }),
    packet('trade_context'),
    packet('draft_context', { providerCapabilityDomain: 'mock_draft' }),
  ]
}

function expectFactsOnlySummary(summary: NflRedraftPremiumServiceSummary) {
  expect(summary.factsOnly).toBe(true)
  expect(summary.deterministic).toBe(true)
  expect(summary.evidencePacketIds.length).toBeGreaterThan(0)
  expect(summary.requiredTier).toBeTruthy()

  const json = JSON.stringify(summary).toLowerCase()
  expect(json).not.toContain('providerpayload')
  expect(json).not.toContain('rawproviderpayload')
  expect(json).not.toContain('do-not-leak')
  expect(json).not.toContain('secret')
  expect(json).not.toContain('start this player')
  expect(json).not.toContain('make this trade')
  expect(json).not.toContain('waiver priority')
  expect(json).not.toContain('collusion')

  const forbiddenKeys = new Set(['recommendation', 'recommendations', 'reasoning', 'llm', 'llmsummary', 'conclusion'])
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      expect(forbiddenKeys.has(key.toLowerCase())).toBe(false)
      visit(entry)
    }
  }
  visit(summary)
}

describe('G49A NFL redraft premium service foundation', () => {
  it('maps premium services to deterministic subscription tier requirements', () => {
    expect(resolveNflRedraftPremiumServiceRequiredTier('basic_runtime_facts')).toBe('FREE')
    expect(resolveNflRedraftPremiumServiceRequiredTier('manager_brief')).toBe('AF_PRO')
    expect(resolveNflRedraftPremiumServiceRequiredTier('matchup_prep')).toBe('AF_PRO')
    expect(resolveNflRedraftPremiumServiceRequiredTier('waiver_report')).toBe('AF_PRO')
    expect(resolveNflRedraftPremiumServiceRequiredTier('trade_review')).toBe('AF_PRO')
    expect(resolveNflRedraftPremiumServiceRequiredTier('trade_review', 'commissioner')).toBe('AF_COMMISSIONER')
    expect(resolveNflRedraftPremiumServiceRequiredTier('commissioner_digest')).toBe('AF_COMMISSIONER')
    expect(resolveNflRedraftPremiumServiceRequiredTier('draft_prep', 'advanced')).toBe('AF_SUPREME')
    expect(resolveNflRedraftPremiumServiceRequiredTier('war_room')).toBe('AF_WAR_ROOM')
  })

  it('enforces tier access without payment integration or provider-specific IDs', () => {
    const canAccess = (
      tier: NflRedraftPremiumTier | null,
      serviceId: Parameters<typeof canAccessNflRedraftPremiumService>[0]['serviceId'],
      variant?: Parameters<typeof canAccessNflRedraftPremiumService>[0]['variant'],
    ) => canAccessNflRedraftPremiumService({ tier, serviceId, variant })

    expect(canAccess(null, 'basic_runtime_facts')).toBe(true)
    expect(canAccess('FREE', 'manager_brief')).toBe(false)
    expect(canAccess('AF_PRO', 'manager_brief')).toBe(true)
    expect(canAccess('AF_SUPREME', 'manager_brief')).toBe(true)
    expect(canAccess('AF_PRO', 'commissioner_digest')).toBe(false)
    expect(canAccess('AF_COMMISSIONER', 'commissioner_digest')).toBe(true)
    expect(canAccess('AF_SUPREME', 'commissioner_digest')).toBe(true)
    expect(canAccess('AF_PRO', 'trade_review', 'commissioner')).toBe(false)
    expect(canAccess('AF_COMMISSIONER', 'trade_review', 'commissioner')).toBe(true)
    expect(canAccess('AF_PRO', 'draft_prep', 'advanced')).toBe(false)
    expect(canAccess('AF_SUPREME', 'draft_prep', 'advanced')).toBe(true)
    expect(canAccess('AF_SUPREME', 'war_room')).toBe(false)
    expect(canAccess('AF_WAR_ROOM', 'war_room')).toBe(true)
  })

  it('builds factual summaries for every premium service from canonical evidence packets only', () => {
    const input = {
      evidencePackets: evidencePackets(),
      canonicalContext: {
        leagueId: 'league-g49a',
        season: 2026,
        week: 1,
        playerIds: ['player-g49a'],
        teamIds: ['team-g49a'],
        matchupIds: ['matchup-g49a'],
        gameIds: ['game-g49a'],
        surfaces: ['player_card'] as NflRedraftEvidenceSurface[],
      },
      generatedAtIso: INGESTED,
    }
    const summaries = [
      buildWarRoomServiceSummary({ ...input, requestedTier: 'AF_WAR_ROOM' }),
      buildCommissionerDigestServiceSummary({ ...input, requestedTier: 'AF_COMMISSIONER' }),
      buildManagerBriefServiceSummary({ ...input, requestedTier: 'AF_PRO' }),
      buildMatchupPrepServiceSummary({ ...input, requestedTier: 'AF_PRO' }),
      buildWaiverReportServiceSummary({ ...input, requestedTier: 'AF_PRO' }),
      buildTradeReviewServiceSummary({ ...input, requestedTier: 'AF_PRO' }),
      buildDraftPrepServiceSummary({ ...input, requestedTier: 'AF_PRO' }),
      buildBasicRuntimeFactsSummary({ ...input, requestedTier: 'FREE' }),
    ]

    expect(summaries.map((summary) => summary.serviceId)).toEqual([
      'war_room',
      'commissioner_digest',
      'manager_brief',
      'matchup_prep',
      'waiver_report',
      'trade_review',
      'draft_prep',
      'basic_runtime_facts',
    ])
    for (const summary of summaries) {
      expect(summary.leagueId).toBe('league-g49a')
      expect(summary.relevantPlayerIds).toContain('player-g49a')
      expect(summary.affectedTeamIds).toContain('team-g49a')
      expect(summary.evidencePacketIds.every((id) => id.startsWith('packet-'))).toBe(true)
      expectFactsOnlySummary(summary)
    }
  })

  it('surfaces stale, fallback, and missing evidence without inventing advice', () => {
    const summary = buildWaiverReportServiceSummary({
      evidencePackets: evidencePackets(),
      requestedTier: 'AF_PRO',
      generatedAtIso: INGESTED,
    })

    expect(summary.freshnessStatus.overall).toBe('missing')
    expect(summary.staleDataWarnings).toEqual(expect.arrayContaining([expect.stringContaining('weather:')]))
    expect(summary.unavailableDataWarnings).toEqual(expect.arrayContaining([expect.stringContaining('waiver_context:')]))
    expect(summary.fallbackStatus.hasFallback).toBe(true)
    expect(summary.actionCategoryLabels).toEqual(
      expect.arrayContaining(['freshness_review', 'fallback_review', 'missing_data_review']),
    )
    expectFactsOnlySummary(summary)
  })

  it('keeps outputs deterministic for identical canonical evidence input', () => {
    const input = {
      serviceId: 'matchup_prep' as const,
      evidencePackets: evidencePackets(),
      requestedTier: 'AF_PRO' as const,
    }

    const first = buildNflRedraftPremiumServiceSummary(input)
    const second = buildNflRedraftPremiumServiceSummary(input)

    expect(first).toEqual(second)
    expect(first.generatedAtIso).toBe('1970-01-01T00:00:00.000Z')
    expectFactsOnlySummary(first)
  })
})
