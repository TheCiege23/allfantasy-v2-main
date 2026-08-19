import { describe, expect, it } from 'vitest'
import {
  NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES,
  buildNflRedraftProductionVerificationReport,
  type NflRedraftProviderOrchestratorCapability,
} from '@/lib/nfl-provider'
import { NFL_REDRAFT_PREMIUM_SERVICE_DEFINITIONS } from '@/lib/redraft-premium/nflRedraftPremiumServices'

function safeText(value: unknown): string {
  return JSON.stringify(value)
    .toLowerCase()
    .replace(/rawproviderpayloadexposed":false/g, '')
    .replace(/providersecretsexposed":false/g, '')
}

describe('G50A NFL redraft production verification', () => {
  it('builds a facts-only production verification report for every production provider', () => {
    const report = buildNflRedraftProductionVerificationReport({
      generatedAtIso: '2026-09-13T20:00:00.000Z',
    })

    expect(report).toMatchObject({
      modelVersion: 'nfl-redraft-production-verification-v1',
      factsOnly: true,
      scope: 'AF_NFL_REDRAFT_ONLY',
      proceedToG50BLaunchHardening: true,
      safeOutput: {
        rawProviderPayloadExposed: false,
        providerSecretsExposed: false,
        providerPayloadToUi: false,
        aiReasoningIncluded: false,
        recommendationsIncluded: false,
      },
    })
    expect(report.providerCoverage.map((row) => row.providerId)).toEqual([
      'rolling_insights',
      'api_sports',
      'thesportsdb',
      'fantasycalc',
      'clearsports',
      'openweather',
      'sleeper',
      'espn',
    ])
    expect(report.providerCoverage.every((row) => row.canonicalPathVerified && row.fallbackBehaviorVerified)).toBe(true)
    expect(report.estimatedProductionReadinessPercent).toBeGreaterThanOrEqual(70)
    expect(report.estimatedProductionReadinessPercent).toBeLessThanOrEqual(90)
  })

  it('certifies every orchestrator capability through provider, canonical, evidence, runtime, premium, and UI stages', () => {
    const report = buildNflRedraftProductionVerificationReport({
      generatedAtIso: '2026-09-13T20:00:00.000Z',
    })
    const capabilities = Object.keys(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES) as NflRedraftProviderOrchestratorCapability[]

    expect(report.capabilityCertification.map((row) => row.capability)).toEqual(capabilities)
    expect(report.capabilityCertification.every((row) =>
      row.providerChain.length > 0 &&
      row.flow.join('>') === 'provider>orchestrator>canonical_model>evidence_packet>runtime>premium_service>ui' &&
      row.canonicalObjects.length > 0 &&
      row.evidenceTypes.length > 0 &&
      row.premiumServices.length > 0 &&
      row.uiSurfaces.length > 0,
    )).toBe(true)
    expect(report.capabilityCertification.find((row) => row.capability === 'fantasy_valuations')).toMatchObject({
      status: 'PASS_WITH_LIMITATIONS',
    })
    expect(report.capabilityCertification.find((row) => row.capability === 'headshots')).toMatchObject({
      status: 'PASS',
      evidenceTypes: ['player_metadata_media'],
    })
  })

  it('covers provider, capability, canonical, evidence, premium, runtime, UI, fallback, cache, and import certification', () => {
    const report = buildNflRedraftProductionVerificationReport({
      generatedAtIso: '2026-09-13T20:00:00.000Z',
    })

    expect(report.certificationMatrix.map((row) => row.category)).toEqual([
      'provider',
      'capability',
      'canonical',
      'evidence',
      'premium',
      'runtime',
      'ui',
      'fallback',
      'cache',
      'import',
    ])
    expect(report.fallbackCertification).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'fantasycalc', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'api_sports', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'thesportsdb', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'openweather', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'clearsports', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'rolling_insights', runtimeSurvives: true, fallbackWorks: true }),
      ]),
    )
    expect(report.cacheCertification.map((row) => row.name)).toEqual([
      'Cache Hit',
      'Cache Miss',
      'Stale/Expired Cache',
      'Canonical Rebuild',
    ])
    expect(report.importCertification.map((row) => row.name)).toEqual([
      'Sleeper Import -> Canonical League -> Runtime',
      'ESPN Import -> Canonical League -> Runtime',
    ])
  })

  it('verifies all premium services and production UI surfaces consume canonical evidence contracts', () => {
    const report = buildNflRedraftProductionVerificationReport({
      generatedAtIso: '2026-09-13T20:00:00.000Z',
    })
    const premiumServices = Object.keys(NFL_REDRAFT_PREMIUM_SERVICE_DEFINITIONS)
    const certifiedServices = new Set(report.capabilityCertification.flatMap((row) => row.premiumServices))

    expect(premiumServices.every((serviceId) => certifiedServices.has(serviceId as never))).toBe(true)
    expect(report.uiCertification.map((row) => row.name)).toEqual([
      'Draft Room',
      'Mock Draft',
      'Roster',
      'Waivers',
      'Trades',
      'Matchups',
      'Player Cards',
      'Team Page',
      'Premium Shells',
      'Dashboard',
    ])
    expect(report.uiCertification.every((row) => row.status === 'PASS_WITH_LIMITATIONS')).toBe(true)
  })

  it('classifies launch blockers and remaining bypasses without treating intentional deferrals as certification failures', () => {
    const report = buildNflRedraftProductionVerificationReport({
      generatedAtIso: '2026-09-13T20:00:00.000Z',
    })

    expect(report.directProviderBypassStatus).toBe('PASS_WITH_LIMITATIONS')
    expect(report.remainingDeferredBypasses).toEqual(
      expect.arrayContaining([
        'app/api/cron/import-scores/route.ts',
        'app/api/cron/import-schedules/route.ts',
        'app/api/cron/import-standings/route.ts',
        'app/api/cron/import-injuries/route.ts',
        'app/api/fantasycalc/route.ts list/trending/compare legacy shapes',
      ]),
    )
    expect(report.remainingDeferredBypasses).not.toContain('lib/player-assets/resolvePlayerHeadshot.ts')
    expect(report.launchBlockerReport.criticalBlockers.length).toBeGreaterThan(0)
    expect(report.launchBlockerReport.mediumIssues.join(' ')).toContain('FantasyCalc')
  })

  it('does not include raw provider payloads, secrets, AI reasoning, or fantasy advice fields', () => {
    const report = buildNflRedraftProductionVerificationReport({
      generatedAtIso: '2026-09-13T20:00:00.000Z',
    })
    const text = safeText(report)

    expect(text).not.toContain('rawproviderpayload')
    expect(text).not.toContain('api_key')
    expect(text).not.toContain('client_secret')
    expect(text).not.toContain('bearer ')
    expect(text).not.toContain('start this player')
    expect(text).not.toContain('make this trade')
    expect(text).not.toContain('waiver priority should')
    expect(report.safeOutput.aiReasoningIncluded).toBe(false)
    expect(report.safeOutput.recommendationsIncluded).toBe(false)
  })
})
