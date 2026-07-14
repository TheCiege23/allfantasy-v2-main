import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'

const { resolvePlatformIdentityMock } = vi.hoisted(() => ({
  resolvePlatformIdentityMock: vi.fn(),
}))

vi.mock('@/lib/shared-services/identity/PlatformIdentityService', () => ({
  resolvePlatformIdentity: resolvePlatformIdentityMock,
}))

import {
  validateDraftAvailability,
  validateLeagueCompleteness,
  validateManagerMapping,
  validatePlayoffBracketAvailability,
  validateRosterCompleteness,
  validateRosterSettingsPresence,
  validateScoringSettingsPresence,
  validateTransactionAvailability,
  runSleeperImportValidation,
} from '@/lib/league-import/sleeper/SleeperImportValidation'

function basePayload(overrides: Partial<SleeperImportPayload> = {}): SleeperImportPayload {
  return {
    league: {
      league_id: 'league-1',
      name: 'Test League',
      sport: 'nfl',
      season: '2026',
      total_rosters: 2,
      scoring_settings: { pts_ppr: 1 },
      roster_positions: ['QB', 'RB'],
    },
    users: [{ user_id: 'sleeper-1', username: 'manager1' }],
    rosters: [
      { roster_id: 1, owner_id: 'sleeper-1', players: ['p1'] },
      { roster_id: 2, owner_id: 'sleeper-2', players: ['p2'] },
    ],
    transactions: [],
    draftPicks: [],
    ...overrides,
  }
}

describe('validateLeagueCompleteness', () => {
  it('passes for a complete league', () => {
    expect(validateLeagueCompleteness(basePayload())).toEqual([])
  })

  it('errors when league_id is missing', () => {
    const findings = validateLeagueCompleteness(basePayload({ league: { ...basePayload().league, league_id: '' } }))
    expect(findings.some((f) => f.code === 'league_missing_id' && f.severity === 'error')).toBe(true)
  })

  it('errors when total_rosters is missing/zero', () => {
    const findings = validateLeagueCompleteness(basePayload({ league: { ...basePayload().league, total_rosters: 0 } }))
    expect(findings.some((f) => f.code === 'league_missing_roster_count')).toBe(true)
  })
})

describe('validateRosterCompleteness', () => {
  it('passes when rosters match expected count and all have players', () => {
    expect(validateRosterCompleteness(basePayload())).toEqual([])
  })

  it('errors when there are no rosters at all', () => {
    const findings = validateRosterCompleteness(basePayload({ rosters: [] }))
    expect(findings.some((f) => f.code === 'rosters_missing' && f.severity === 'error')).toBe(true)
  })

  it('warns on a roster count mismatch', () => {
    const findings = validateRosterCompleteness(
      basePayload({ rosters: [{ roster_id: 1, owner_id: 'sleeper-1', players: ['p1'] }] })
    )
    expect(findings.some((f) => f.code === 'rosters_count_mismatch')).toBe(true)
  })

  it('warns when some rosters have no players', () => {
    const findings = validateRosterCompleteness(
      basePayload({
        rosters: [
          { roster_id: 1, owner_id: 'sleeper-1', players: ['p1'] },
          { roster_id: 2, owner_id: 'sleeper-2', players: [] },
        ],
      })
    )
    expect(findings.some((f) => f.code === 'rosters_partial')).toBe(true)
  })
})

describe('field-presence validators', () => {
  it('flags missing scoring settings', () => {
    const findings = validateScoringSettingsPresence(basePayload({ league: { ...basePayload().league, scoring_settings: undefined } }))
    expect(findings.some((f) => f.code === 'scoring_settings_missing')).toBe(true)
  })

  it('flags missing roster settings', () => {
    const findings = validateRosterSettingsPresence(basePayload({ league: { ...basePayload().league, roster_positions: undefined } }))
    expect(findings.some((f) => f.code === 'roster_settings_missing')).toBe(true)
  })

  it('flags unavailable transactions as info, not error', () => {
    const findings = validateTransactionAvailability(basePayload({ transactions: [] }))
    expect(findings).toEqual([expect.objectContaining({ code: 'transactions_unavailable', severity: 'info' })])
  })

  it('flags unavailable draft picks as info, not error', () => {
    const findings = validateDraftAvailability(basePayload({ draftPicks: [] }))
    expect(findings).toEqual([expect.objectContaining({ code: 'draft_unavailable', severity: 'info' })])
  })

  it('always reports playoff bracket results as unsupported (info)', () => {
    const findings = validatePlayoffBracketAvailability(basePayload())
    expect(findings).toEqual([expect.objectContaining({ code: 'playoff_bracket_results_unsupported', severity: 'info' })])
  })
})

describe('validateManagerMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes when the importing user has a stored Sleeper identity that is a league member', async () => {
    resolvePlatformIdentityMock.mockResolvedValue({
      resolutionMethod: 'stored',
      providerUserId: 'sleeper-1',
    })

    const findings = await validateManagerMapping('af-user-1', basePayload())
    expect(findings).toEqual([])
  })

  it('warns when the importing user has no linked Sleeper identity', async () => {
    resolvePlatformIdentityMock.mockResolvedValue({
      resolutionMethod: 'not_available',
      providerUserId: null,
    })

    const findings = await validateManagerMapping('af-user-1', basePayload())
    expect(findings.some((f) => f.code === 'manager_identity_unlinked')).toBe(true)
  })

  it('warns when the linked identity is not a member of this league', async () => {
    resolvePlatformIdentityMock.mockResolvedValue({
      resolutionMethod: 'stored',
      providerUserId: 'sleeper-not-in-league',
    })

    const findings = await validateManagerMapping('af-user-1', basePayload())
    expect(findings.some((f) => f.code === 'manager_identity_not_in_league')).toBe(true)
  })
})

describe('runSleeperImportValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is valid (no errors) for a fully complete payload with no fantasyUserId supplied', async () => {
    const result = await runSleeperImportValidation(basePayload())
    expect(result.isValid).toBe(true)
    expect(result.findings.some((f) => f.severity === 'error')).toBe(false)
  })

  it('is invalid when league completeness fails', async () => {
    const result = await runSleeperImportValidation(basePayload({ rosters: [] }))
    expect(result.isValid).toBe(false)
  })

  it('includes manager mapping findings only when a fantasyUserId is supplied', async () => {
    resolvePlatformIdentityMock.mockResolvedValue({ resolutionMethod: 'not_available', providerUserId: null })

    const withoutUser = await runSleeperImportValidation(basePayload())
    expect(withoutUser.findings.some((f) => f.code === 'manager_identity_unlinked')).toBe(false)

    const withUser = await runSleeperImportValidation(basePayload(), 'af-user-1')
    expect(withUser.findings.some((f) => f.code === 'manager_identity_unlinked')).toBe(true)
  })
})
