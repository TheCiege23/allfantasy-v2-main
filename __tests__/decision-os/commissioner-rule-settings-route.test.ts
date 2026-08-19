/**
 * Commissioner Intelligence Platform — Phase 6: Rule / Settings route test.
 *
 * Verifies the internal A1 route's gate + commissioner-auth contract with the
 * DB/resolver mocked out: default-off flag, session (401), commissioner (403 when
 * assertCommissioner throws), the `{ enabled, data? }` envelope, and a graceful 500.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getServerSessionMock, assertCommissionerMock, getSettingsMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  assertCommissionerMock: vi.fn(),
  getSettingsMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: assertCommissionerMock }))
vi.mock('@/lib/decision-os/commissioner-intelligence/rule-settings', () => ({
  createLiveRuleSettingsDataProvider: () => ({ getCommissionerRuleSettings: getSettingsMock }),
}))

import { GET } from '@/app/api/app/leagues/[leagueId]/commissioner/rule-settings/route'

function call(leagueId = 'L1') {
  return GET({} as never, { params: Promise.resolve({ leagueId }) })
}

const SAMPLE = {
  version: 'commissioner-rule-settings.v1',
  derivedAt: '2026-11-20T00:00:00.000Z',
  leagueFormat: 'advanced',
  rosterComplexity: 'complex',
  scoringComplexity: 'complex',
  transactionPolicy: 'reviewed',
  playoffConfiguration: 'custom',
  settingsHighlights: ['12-team league', 'Superflex', 'IDP'],
  caveats: [],
  summary: 'This league uses an advanced configuration. It includes a 12-team league, Superflex, and IDP.',
  source: 'settings_snapshot',
}

beforeEach(() => {
  getServerSessionMock.mockResolvedValue({ user: { id: 'commish-1' } })
  assertCommissionerMock.mockResolvedValue(undefined)
  getSettingsMock.mockResolvedValue(SAMPLE)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('GET /api/app/leagues/[leagueId]/commissioner/rule-settings', () => {
  it('is default-off: returns { enabled:false } and never touches the resolver', async () => {
    vi.stubEnv('COMMISSIONER_RULE_SETTINGS_ENABLED', 'false')
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
    expect(getSettingsMock).not.toHaveBeenCalled()
  })

  it('401 when there is no session', async () => {
    vi.stubEnv('COMMISSIONER_RULE_SETTINGS_ENABLED', 'true')
    getServerSessionMock.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('403 when the user is not a commissioner', async () => {
    vi.stubEnv('COMMISSIONER_RULE_SETTINGS_ENABLED', 'true')
    assertCommissionerMock.mockRejectedValue(new Error('not commissioner'))
    const res = await call()
    expect(res.status).toBe(403)
    expect(getSettingsMock).not.toHaveBeenCalled()
  })

  it('200 { enabled:true, data } for a commissioner', async () => {
    vi.stubEnv('COMMISSIONER_RULE_SETTINGS_ENABLED', 'true')
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.data.leagueFormat).toBe('advanced')
    expect(getSettingsMock).toHaveBeenCalledWith({ leagueId: 'L1' })
  })

  it('200 { enabled:true } (no data) when the league row does not exist', async () => {
    vi.stubEnv('COMMISSIONER_RULE_SETTINGS_ENABLED', 'true')
    getSettingsMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true })
  })

  it('500 (gracefully) when the resolver throws', async () => {
    vi.stubEnv('COMMISSIONER_RULE_SETTINGS_ENABLED', 'true')
    getSettingsMock.mockRejectedValue(new Error('boom'))
    expect((await call()).status).toBe(500)
  })
})
