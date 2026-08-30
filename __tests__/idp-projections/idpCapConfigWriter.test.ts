/**
 * The IDP salary-cap system had fifteen readers and no writer.
 *
 * 🛑 `IDPCapConfig` was read in capEngine (7 sites), idpCapChimmy (4) and three cap routes, and
 * CREATED NOWHERE. Every reader begins `findUnique` and then either throws "No IDP cap
 * configuration for this league" or returns an empty shape, so salaries, dead money, franchise
 * tags, extensions, cap projections and both cap pages were unreachable by construction — not
 * broken, impossible to turn on. Measured in production 2026-08-30: all fourteen cap/contract
 * tables held 0 rows.
 *
 * The commissioner UI made it worse rather than better: IDPCapPanel took no props, held 22
 * useState values, made zero fetch calls, and told the commissioner "Save wiring to league
 * services can connect these controls when ready". Every control responded and nothing was
 * stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  assertCommissioner: vi.fn(),
  isIdpLeague: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: mocks.assertCommissioner }))
vi.mock('@/lib/idp', () => ({ isIdpLeague: mocks.isIdpLeague }))
vi.mock('@/lib/idp/IdpSettingsAudit', () => ({ writeIdpSettingsAudit: mocks.writeAudit }))
vi.mock('@/lib/prisma', () => ({
  prisma: { iDPCapConfig: { findUnique: mocks.findUnique, upsert: mocks.upsert } },
}))

const PARAMS = { params: Promise.resolve({ leagueId: 'lg1' }) }
const route = () => import('@/app/api/commissioner/leagues/[leagueId]/idp/cap-config/route')
const put = async (body: unknown) => {
  const { PUT } = await route()
  return PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }), PARAMS as never)
}
const get = async () => {
  const { GET } = await route()
  return GET(new Request('http://x'), PARAMS as never)
}

describe('the IDP cap config writer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ user: { id: 'u1' } })
    mocks.assertCommissioner.mockResolvedValue(undefined)
    mocks.isIdpLeague.mockResolvedValue(true)
    mocks.findUnique.mockResolvedValue(null)
    mocks.upsert.mockImplementation(async (a: { create?: object }) => ({ id: 'cfg1', leagueId: 'lg1', ...(a.create ?? {}) }))
    mocks.writeAudit.mockResolvedValue(undefined)
  })

  /** 🛑 THE ASSERTION THE WHOLE SYSTEM WAS MISSING: something can create the row. */
  it('creates a config for a league that has none', async () => {
    const res = await put({ totalCap: 220, isHardCap: false })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(true)
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.upsert.mock.calls[0][0].create).toMatchObject({ leagueId: 'lg1', totalCap: 220, isHardCap: false })
  })

  /** Only what the caller sent — an omitted field must keep its stored or schema default. */
  it('does not overwrite fields the caller omitted', async () => {
    await put({ totalCap: 150 })
    const call = mocks.upsert.mock.calls[0][0]
    expect(call.update).toEqual({ totalCap: 150 })
    expect(call.update).not.toHaveProperty('franchiseTagValue')
  })

  /**
   * ⚠ THE CROSS-FIELD ONE THAT ACTUALLY BITES. calculateSnakeScaleSalary interpolates between
   * high and low across the pick range; inverted, the first overall pick gets the draft's
   * cheapest contract and nothing downstream flags it.
   */
  it('refuses an inverted snake scale', async () => {
    const res = await put({ snakeScaleHighSalary: 1, snakeScaleLowSalary: 30 })
    expect(res.status).toBe(400)
    expect((await res.json()).errors.join(' ')).toMatch(/high salary must be greater than or equal/i)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a percentage given as 75 rather than 0.75', async () => {
    const res = await put({ capFloorEnabled: true, capFloor: 75 })
    expect(res.status).toBe(400)
    expect((await res.json()).errors.join(' ')).toMatch(/between 0 and 1/i)
  })

  it('refuses a franchise tag larger than the whole cap', async () => {
    const res = await put({ totalCap: 100, franchiseTagValue: 150 })
    expect(res.status).toBe(400)
    expect((await res.json()).errors.join(' ')).toMatch(/cannot exceed the total cap/i)
  })

  it('refuses an unknown draft salary method', async () => {
    const res = await put({ draftSalaryMethod: 'blind_bid' })
    expect(res.status).toBe(400)
  })

  /** Disabling the floor clears the number, so re-enabling cannot silently reuse an old one. */
  it('clears capFloor when the floor is disabled', async () => {
    await put({ capFloorEnabled: false })
    expect(mocks.upsert.mock.calls[0][0].update).toMatchObject({ capFloorEnabled: false, capFloor: null })
  })

  /**
   * ⚠ SEASON IS NOT SETTABLE. expireContractsForNewSeason rolls it; a commissioner editing it
   * mid-season would silently re-date every active contract's eligibility window.
   */
  it('ignores season even when supplied', async () => {
    await put({ totalCap: 200, season: 1999 } as never)
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty('season')
  })

  it('is commissioner-gated and IDP-gated', async () => {
    mocks.assertCommissioner.mockRejectedValue(new Error('no'))
    expect((await put({ totalCap: 200 })).status).toBe(403)
    mocks.assertCommissioner.mockResolvedValue(undefined)
    mocks.isIdpLeague.mockResolvedValue(false)
    expect((await put({ totalCap: 200 })).status).toBe(404)
    mocks.isIdpLeague.mockResolvedValue(true)
    mocks.getServerSession.mockResolvedValue(null)
    expect((await put({ totalCap: 200 })).status).toBe(401)
  })

  /** An audit failure must not lose the commissioner's setting. */
  it('still saves when the audit write fails', async () => {
    mocks.writeAudit.mockRejectedValue(new Error('audit down'))
    expect((await put({ totalCap: 210 })).status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalled()
  })

  it('reports configured:false rather than 404 for a league with no cap yet', async () => {
    const body = await (await get()).json()
    expect(body).toMatchObject({ leagueId: 'lg1', configured: false, config: null })
  })
})
