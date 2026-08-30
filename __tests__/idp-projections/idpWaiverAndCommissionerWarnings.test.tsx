/**
 * Two IDP surfaces that reported something they had not measured.
 *
 * 1. components/idp/IDPWaiverSection rendered two HARDCODED rows styled as waiver targets
 *    ("Use AI Targets", "DL / LB / DB"). Worse than filler: because the fallback keyed on
 *    `targets?.length`, a genuine empty answer from Chimmy re-rendered the fake rows, so
 *    "no IDP targets stood out this week" was indistinguishable from "here are two targets".
 *
 * 2. The commissioner IDP trade-warnings route did a session check, a commissioner check and
 *    an isIdpLeague read, then returned a PROSE STRING telling the caller to go run the trade
 *    evaluator by hand. Auth-gated documentation, not an answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  assertCommissioner: vi.fn(),
  isIdpLeague: vi.fn(),
  tradeFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  getRosterDefaults: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: mocks.assertCommissioner }))
vi.mock('@/lib/idp', () => ({ isIdpLeague: mocks.isIdpLeague }))
vi.mock('@/lib/idp/IDPLeagueConfig', () => ({ getRosterDefaultsForIdpLeague: mocks.getRosterDefaults }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    afLeagueTrade: { findMany: mocks.tradeFindMany },
    roster: { findMany: mocks.rosterFindMany },
  },
}))
vi.mock('@/hooks/useAfSubGate', () => ({
  useAfSubGate: () => ({ handleApiResponse: async () => true }),
}))

import { IDPWaiverSection } from '@/components/idp/IDPWaiverSection'

const PARAMS = { params: Promise.resolve({ leagueId: 'lg1' }) }
const callRoute = async () => {
  const { GET } = await import('@/app/api/commissioner/leagues/[leagueId]/idp/trade-warnings/route')
  return GET(new Request('http://x/api'), PARAMS as any)
}

describe('IDP waiver section shows no invented rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** THE ASSERTION THE OLD COMPONENT FAILED ON FIRST RENDER. */
  it('renders no fabricated target rows before anything is loaded', () => {
    render(<IDPWaiverSection leagueId="lg1" week={3} />)
    expect(screen.queryByText(/Loads personalized waiver ideas from Chimmy/)).toBeNull()
    expect(screen.queryByText(/Prioritize high-snap roles/)).toBeNull()
    expect(screen.queryByTestId('idp-waiver-targets')).toBeNull()
  })

  it('invites the user to load targets instead', () => {
    render(<IDPWaiverSection leagueId="lg1" week={3} />)
    expect(screen.getByTestId('idp-waiver-empty').textContent).toMatch(/Tap AI Targets/)
  })

  /**
   * THE BUG BEHIND THE BUG. The old fallback keyed on `targets?.length`, so an empty AI
   * response fell through to the hardcoded rows: a real "nothing this week" answer was
   * displayed as two suggestions.
   */
  it('distinguishes an empty AI answer from never having asked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    render(<IDPWaiverSection leagueId="lg1" week={3} />)
    screen.getByTestId('idp-waiver-ai-targets').click()
    await vi.waitFor(() => {
      expect(screen.getByTestId('idp-waiver-empty').textContent).toMatch(/No IDP waiver targets stood out/)
    })
    expect(screen.queryByText(/Loads personalized waiver ideas/)).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('commissioner IDP trade warnings returns data, not instructions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ user: { id: 'u1' } })
    mocks.assertCommissioner.mockResolvedValue(undefined)
    mocks.isIdpLeague.mockResolvedValue(true)
    mocks.getRosterDefaults.mockResolvedValue({ starter_slots: { LB: 2, DL: 2, DB: 2 } })
    mocks.rosterFindMany.mockResolvedValue([])
    mocks.tradeFindMany.mockResolvedValue([])
  })

  /** THE STUB SIGNATURE: a `message` telling the caller to call something else. */
  it('no longer answers with prose telling the caller to run the evaluator', async () => {
    const body = await (await callRoute()).json()
    expect(body.message).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/POST \/api\/trade-evaluator/)
    expect(body).toMatchObject({ leagueId: 'lg1', applicable: true, pendingTradesChecked: 0, warnings: [] })
  })

  it('flags a pending trade that strips a side below its IDP starter slots', async () => {
    mocks.tradeFindMany.mockResolvedValue([
      {
        id: 't1',
        proposerRosterId: 'r1',
        receiverRosterId: 'r2',
        createdAt: new Date(0),
        expiresAt: null,
        items: [
          { itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2', metadata: { name: 'Micah Parsons', position: 'LB' } },
          { itemType: 'player', itemReference: 'p2', fromRosterId: 'r2', toRosterId: 'r1', metadata: { name: 'Wide Out', position: 'WR' } },
        ],
      },
    ])
    mocks.rosterFindMany.mockResolvedValue([
      // r1 sits on exactly 6 IDP bodies and trades one away, leaving 5 against 6 required.
      {
        id: 'r1',
        playerData: [
          { name: 'Micah Parsons', position: 'LB' },
          { name: 'A', position: 'LB' },
          { name: 'B', position: 'DE' },
          { name: 'C', position: 'DT' },
          { name: 'D', position: 'CB' },
          { name: 'E', position: 'S' },
        ],
      },
      { id: 'r2', playerData: Array.from({ length: 9 }, (_, i) => ({ name: `R2-${i}`, position: 'LB' })) },
    ])
    const body = await (await callRoute()).json()
    expect(body.pendingTradesChecked).toBe(1)
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0].tradeId).toBe('t1')
    expect(body.warnings[0].sides).toEqual(['Proposer'])
    /*
     * ALSO ASSERTED ON THE POPULATED PATH ON PURPOSE. The prose-stub check above runs against
     * the zero-trades early return, so on its own it could never catch a `message` reinstated
     * on the main return. Verified by mutation: patching only the final return left that test
     * green.
     */
    expect(body.message).toBeUndefined()
    /** The wording must match the evaluator, since both describe the same rule. */
    expect(body.warnings[0].message).toContain(
      'would not have enough IDP-eligible players to field a legal lineup (6 IDP starter slots required)'
    )
  })

  it('stays silent when both sides keep a legal lineup', async () => {
    mocks.tradeFindMany.mockResolvedValue([
      {
        id: 't2',
        proposerRosterId: 'r1',
        receiverRosterId: 'r2',
        createdAt: new Date(0),
        expiresAt: null,
        items: [{ itemType: 'player', itemReference: 'p9', fromRosterId: 'r1', toRosterId: 'r2', metadata: { name: 'X', position: 'WR' } }],
      },
    ])
    mocks.rosterFindMany.mockResolvedValue([
      {
        id: 'r1',
        playerData: Array.from({ length: 8 }, (_, i) => ({ name: `A${i}`, position: 'LB' })).concat([{ name: 'X', position: 'WR' }]),
      },
      { id: 'r2', playerData: Array.from({ length: 8 }, (_, i) => ({ name: `B${i}`, position: 'LB' })) },
    ])
    const body = await (await callRoute()).json()
    expect(body.pendingTradesChecked).toBe(1)
    expect(body.warnings).toEqual([])
  })

  /**
   * A PICKS-ONLY TRADE IS NOT "CHECKED AND CLEAN". Nothing in it can change IDP eligibility,
   * so counting it would inflate pendingTradesChecked and imply coverage never performed.
   */
  it('does not count a picks-only trade as checked', async () => {
    mocks.tradeFindMany.mockResolvedValue([
      {
        id: 't3',
        proposerRosterId: 'r1',
        receiverRosterId: 'r2',
        createdAt: new Date(0),
        expiresAt: null,
        items: [{ itemType: 'rookie_pick', itemReference: '2027 1st', fromRosterId: 'r1', toRosterId: 'r2', metadata: {} }],
      },
    ])
    const body = await (await callRoute()).json()
    expect(body.pendingTradesChecked).toBe(0)
    expect(body.warnings).toEqual([])
  })

  /**
   * ZERO IDP SLOTS IS NOT "NO WARNINGS". canFieldLegalIdpLineup returns true for everything
   * when required is 0, so an empty list would read as "every trade is safe" rather than
   * "the question does not apply here".
   */
  it('says the question does not apply when the league has no IDP starter slots', async () => {
    mocks.getRosterDefaults.mockResolvedValue({ starter_slots: { QB: 1, RB: 2 } })
    const body = await (await callRoute()).json()
    expect(body.applicable).toBe(false)
    expect(body.requiredIdpStarterSlots).toBe(0)
    expect(mocks.tradeFindMany).not.toHaveBeenCalled()
  })

  it('still refuses non-commissioners and non-IDP leagues', async () => {
    mocks.assertCommissioner.mockRejectedValue(new Error('nope'))
    expect((await callRoute()).status).toBe(403)
    mocks.assertCommissioner.mockResolvedValue(undefined)
    mocks.isIdpLeague.mockResolvedValue(false)
    expect((await callRoute()).status).toBe(404)
  })
})
