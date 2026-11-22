import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Survivor Guilly league creation is ONE transaction: the redraft shell and its season rules commit
 * together, and a request the schedule cannot fit is refused before any write.
 */

const tx = vi.hoisted(() => ({ marker: 'tx' }))
const transactionMock = vi.hoisted(() => vi.fn())
const createInTxMock = vi.hoisted(() => vi.fn())
const writeRulesMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
    leagueIntegritySettings: { upsert: vi.fn().mockResolvedValue({}) },
    draftSession: { findFirst: vi.fn().mockResolvedValue(null) },
    leagueSettings: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/lib/league-creation/preset-engine/runPresetEngine', () => ({
  runPresetEngine: vi.fn(() => ({ leagueFormatId: 'redraft', presetKey: 'pk-test', warnings: [] })),
}))
vi.mock('@/lib/league-creation/canonical/createCanonicalLeagueInTransaction', () => ({
  createCanonicalLeagueInTransaction: createInTxMock,
}))
vi.mock('@/lib/league-creation/canonical/createZombieUniverseInTransaction', () => ({
  createZombieUniverseInTransaction: vi.fn(),
}))
vi.mock('@/lib/league-creation/canonical/carryOverImportedLeague', () => ({
  carryOverImportedLeague: vi.fn(),
  ImportedLeagueCarryoverError: class extends Error {},
}))
vi.mock('@/lib/survivor-guillotine/rulesWrite', () => ({ writeSGRulesInTransaction: writeRulesMock }))
vi.mock('@/server/services/auditService', () => ({ logLeagueCreated: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getLeagueDraftTemplatePayload: vi.fn().mockResolvedValue({ template: null, totalRosterSlots: 0 }),
}))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueCreatedNotice: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator', () => ({
  runPostCreateInitialization: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/integrity/integrityDefaults', () => ({ NEW_LEAGUE_INTEGRITY_DEFAULTS: {} }))
vi.mock('@/lib/league/format-artifact-service', () => ({ generateLeagueConstitutionArtifact: vi.fn() }))
vi.mock('@/lib/league-setup/autoMaterializeDraftForLeague', () => ({
  autoMaterializeDraftForLeague: vi.fn().mockResolvedValue({ ok: false, reason: 'test' }),
}))

function body(overrides: Record<string, unknown> = {}) {
  return {
    concept: 'survivor_guillotine',
    sport: 'NFL',
    teamCount: 22,
    draftType: 'snake',
    scoringPreset: 'fb_half_ppr',
    leagueName: 'Tribal Chop',
    timezone: 'America/New_York',
    conceptSetup: { survivorGuillotineTribeCount: 3 },
    ...overrides,
  } as never
}

describe('Survivor Guilly create transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transactionMock.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx))
    createInTxMock.mockResolvedValue({ leagueId: 'league-sg', homepageUrl: '/league/league-sg' })
    writeRulesMock.mockResolvedValue({ leagueId: 'league-sg', status: 'setup', revision: 0 })
  })

  it('writes the fitted rules inside the league transaction and lands on the season setup page', async () => {
    const { executeCanonicalLeagueCreation } = await import('@/lib/league-creation/canonical/executeCanonicalLeagueCreation')
    const result = await executeCanonicalLeagueCreation({ appUserId: 'user-1', body: body() })
    expect(result.ok).toBe(true)
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(writeRulesMock).toHaveBeenCalledTimes(1)
    const [client, leagueId, config] = writeRulesMock.mock.calls[0]!
    expect(client).toBe(tx)
    expect(leagueId).toBe('league-sg')
    expect(config).toMatchObject({ sport: 'NFL', teamCount: 22, tribeCount: 3, gauntletPeriods: 3, mergedChopPeriods: 3 })
    if (result.ok) expect(result.response.homepageUrl).toBe('/survivor-guillotine/setup?leagueId=league-sg')
  })

  it('rolls the league back with its rules: a failed rules write fails the whole create', async () => {
    writeRulesMock.mockRejectedValueOnce(new Error('rules write failed'))
    const { executeCanonicalLeagueCreation } = await import('@/lib/league-creation/canonical/executeCanonicalLeagueCreation')
    const result = await executeCanonicalLeagueCreation({ appUserId: 'user-1', body: body() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(500)
  })

  it.each([
    ['an unsupported sport', { sport: 'MLB', scoringPreset: 'mlb_points' }, 'sport'],
    ['a size no schedule can finish', { teamCount: 40 }, 'teamCount'],
    ['an out-of-range tribe count', { conceptSetup: { survivorGuillotineTribeCount: 6 } }, 'conceptSetup.survivorGuillotineTribeCount'],
  ])('refuses %s before opening a transaction', async (_label, overrides, path) => {
    const { executeCanonicalLeagueCreation } = await import('@/lib/league-creation/canonical/executeCanonicalLeagueCreation')
    const result = await executeCanonicalLeagueCreation({ appUserId: 'user-1', body: body(overrides) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.response.errors?.[0]?.path).toBe(path)
    }
    expect(transactionMock).not.toHaveBeenCalled()
    expect(writeRulesMock).not.toHaveBeenCalled()
  })

  it('leaves every other concept untouched', async () => {
    const { executeCanonicalLeagueCreation } = await import('@/lib/league-creation/canonical/executeCanonicalLeagueCreation')
    const result = await executeCanonicalLeagueCreation({ appUserId: 'user-1', body: body({ concept: 'redraft', teamCount: 12, conceptSetup: {} }) })
    expect(result.ok).toBe(true)
    expect(writeRulesMock).not.toHaveBeenCalled()
    if (result.ok) expect(result.response.homepageUrl).toBe('/league/league-sg')
  })
})
