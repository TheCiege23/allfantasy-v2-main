import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The AF Legacy trade tools' door to THE trade grade (`lib/legacy/legacyOneGrade.ts`) and the
 * shape they print (`lib/legacy/legacyPackageGrade.ts`).
 *
 * Only the league resolution and the grader's CONSTRUCTION are mocked — `gradeDeal` is the real one,
 * so the unpriceable-asset refusal and the null-grader answer are exercised, not restated.
 */

const mockResolveLeague = vi.hoisted(() => vi.fn())
const mockCreateGrader = vi.hoisted(() => vi.fn())
const mockSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/decision-os/trade/evaluationLeague', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/trade/evaluationLeague')>(
    '@/lib/decision-os/trade/evaluationLeague',
  )
  return { ...actual, resolveEvaluationLeagueId: mockResolveLeague }
})
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/trade/leagueTradeGrader')>(
    '@/lib/decision-os/trade/leagueTradeGrader',
  )
  return { ...actual, createLeagueTradeGrader: mockCreateGrader }
})
vi.mock('next-auth', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { NOT_YOUR_LEAGUE_REASON } from '@/lib/decision-os/trade/evaluationLeague'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import {
  createLegacyPackageGrader,
  legacySessionUserId,
  NO_LEAGUE_TO_GRADE_REASON,
  SIGN_IN_TO_GRADE_REASON,
} from '@/lib/legacy/legacyOneGrade'
import {
  gradeInputsFromEngineAssets,
  gradeInputsFromRosterAssets,
  legacyPackageGrade,
} from '@/lib/legacy/legacyPackageGrade'

const GRADED: TradeGradeView = {
  graded: true,
  letter: 'D',
  partnerLetter: 'B',
  percentDiff: -18,
  label: 'Slightly favors opponent',
  sideAdvantage: 'opponent',
  action: 'counter',
  recommendation: 'Ask for a little more back.',
  giveValue: 6100,
  getValue: 5000,
  giveMarket: 6000,
  getMarket: 5100,
  basis: 'Dynasty · Superflex · 12 teams · PPR',
  scoringApplied: true,
  needApplied: false,
  needGap: null,
  lines: [],
  moves: [],
} as TradeGradeView

function fakeGrader(view: TradeGradeView = GRADED) {
  return { leagueId: 'af-1', chart: {}, leagueType: {}, grade: vi.fn(async () => view) }
}

const give = { assets: [{ kind: 'player' as const, name: 'Bijan Robinson' }], unpriceable: [] }
const get = { assets: [{ kind: 'player' as const, name: 'Puka Nacua' }], unpriceable: [] }

beforeEach(() => {
  mockResolveLeague.mockReset()
  mockCreateGrader.mockReset()
  mockSession.mockReset()
})

describe('createLegacyPackageGrader — the one grader, behind the membership proof', () => {
  it('grades through the one grader, on the league the membership check resolved, from the give side', async () => {
    const grader = fakeGrader()
    mockResolveLeague.mockResolvedValue('af-1')
    mockCreateGrader.mockResolvedValue(grader)

    const gradeOf = await createLegacyPackageGrader({ suppliedLeagueId: 'sleeper-99', userId: 'u1' })
    const g = await gradeOf(give, get)

    expect(mockResolveLeague).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-99', userId: 'u1' })
    expect(mockCreateGrader).toHaveBeenCalledWith({ leagueId: 'af-1', userId: 'u1' })
    expect(grader.grade).toHaveBeenCalledWith({ give: give.assets, get: get.assets, viewerSide: false })
    expect(g).toEqual({
      graded: true,
      letter: 'D',
      partnerLetter: 'B',
      label: 'Slightly favors opponent',
      recommendation: 'Ask for a little more back.',
      giveValue: 6100,
      getValue: 5000,
      basis: 'Dynasty · Superflex · 12 teams · PPR',
    })
  })

  it('loads the league once for many deals', async () => {
    mockResolveLeague.mockResolvedValue('af-1')
    mockCreateGrader.mockResolvedValue(fakeGrader())
    const gradeOf = await createLegacyPackageGrader({ suppliedLeagueId: 'sleeper-99', userId: 'u1', viewerSide: true })
    await Promise.all([gradeOf(give, get), gradeOf(get, give), gradeOf(give, give)])
    expect(mockCreateGrader).toHaveBeenCalledTimes(1)
  })

  it('withholds, with the reason, when no league was sent', async () => {
    const g = await (await createLegacyPackageGrader({ suppliedLeagueId: '  ', userId: 'u1' }))(give, get)
    expect(g).toEqual({ graded: false, reason: NO_LEAGUE_TO_GRADE_REASON })
    expect(mockCreateGrader).not.toHaveBeenCalled()
  })

  it('withholds for a signed-out caller — the league is never read for someone we cannot place in it', async () => {
    const g = await (await createLegacyPackageGrader({ suppliedLeagueId: 'sleeper-99', userId: null }))(give, get)
    expect(g).toEqual({ graded: false, reason: SIGN_IN_TO_GRADE_REASON })
    expect(mockResolveLeague).not.toHaveBeenCalled()
    expect(mockCreateGrader).not.toHaveBeenCalled()
  })

  it('withholds when the league is not one of theirs', async () => {
    mockResolveLeague.mockResolvedValue(null)
    const g = await (await createLegacyPackageGrader({ suppliedLeagueId: 'someone-elses', userId: 'u1' }))(give, get)
    expect(g).toEqual({ graded: false, reason: NOT_YOUR_LEAGUE_REASON })
    expect(mockCreateGrader).not.toHaveBeenCalled()
  })

  it('an unreadable league is the real gradeDeal’s null-grader answer, not an error', async () => {
    mockResolveLeague.mockResolvedValue('af-1')
    mockCreateGrader.mockRejectedValue(new Error('db down'))
    const g = await (await createLegacyPackageGrader({ suppliedLeagueId: 'sleeper-99', userId: 'u1' }))(give, get)
    expect(g.graded).toBe(false)
    expect(g.graded ? '' : g.reason).toMatch(/could not be loaded/)
  })

  it('an asset that cannot be priced withholds the deal (the real gradeDeal refusal)', async () => {
    const grader = fakeGrader()
    mockResolveLeague.mockResolvedValue('af-1')
    mockCreateGrader.mockResolvedValue(grader)
    const g = await (await createLegacyPackageGrader({ suppliedLeagueId: 'sleeper-99', userId: 'u1' }))(
      { assets: [], unpriceable: ['a draft pick with no season or round'] },
      get,
    )
    expect(g.graded).toBe(false)
    expect(grader.grade).not.toHaveBeenCalled()
  })

  it('a grader that throws mid-deal is a withheld grade, never a thrown request', async () => {
    mockResolveLeague.mockResolvedValue('af-1')
    mockCreateGrader.mockResolvedValue({ ...fakeGrader(), grade: vi.fn(async () => { throw new Error('boom') }) })
    const g = await (await createLegacyPackageGrader({ suppliedLeagueId: 'sleeper-99', userId: 'u1' }))(give, get)
    expect(g).toEqual({ graded: false, reason: 'This deal could not be priced just now.' })
  })
})

describe('legacySessionUserId', () => {
  it('reads the session user and never throws', async () => {
    mockSession.mockResolvedValueOnce({ user: { id: ' u9 ' } })
    expect(await legacySessionUserId()).toBe('u9')
    mockSession.mockRejectedValueOnce(new Error('no'))
    expect(await legacySessionUserId()).toBeNull()
    mockSession.mockResolvedValueOnce(null)
    expect(await legacySessionUserId()).toBeNull()
  })
})

describe('legacyPackageGrade — nothing recomputed', () => {
  it('a withheld view keeps its reason', () => {
    expect(legacyPackageGrade({ graded: false, reason: 'Why.', basis: null })).toEqual({ graded: false, reason: 'Why.' })
  })
})

describe('grade inputs from the legacy tools’ asset shapes', () => {
  it('engine assets: verified identity when present, name otherwise; picks by season and round', () => {
    const inputs = gradeInputsFromEngineAssets([
      { type: 'PLAYER', name: 'Bijan Robinson', valuationIdentity: { provider: 'sleeper', id: '9509', position: 'RB' } },
      { type: 'PLAYER', name: 'Puka Nacua' },
      { type: 'PICK', pickSeason: 2027, round: 1, displayName: '2027 1st' },
      { type: 'FAAB', faabAmount: 12 },
    ])
    expect(inputs).toEqual({
      assets: [
        { kind: 'player', name: 'Bijan Robinson', providerIdentity: { provider: 'sleeper', id: '9509', position: 'RB' } },
        { kind: 'player', name: 'Puka Nacua' },
        { kind: 'pick', year: 2027, round: 1, label: '2027 1st' },
        { kind: 'faab', amount: 12 },
      ],
      unpriceable: [],
    })
  })

  it('engine assets: an unreadable pick, FAAB or nameless player is NAMED, never dropped', () => {
    const inputs = gradeInputsFromEngineAssets([
      { type: 'PICK', displayName: 'A future pick' },
      { type: 'FAAB' },
      { type: 'PLAYER', name: ' ' },
    ])
    expect(inputs.assets).toEqual([])
    expect(inputs.unpriceable).toEqual(['A future pick', 'a FAAB amount', 'a player with no name'])
  })

  it('roster assets (the proposal generator): players by name, picks by year and round', () => {
    expect(
      gradeInputsFromRosterAssets([
        { type: 'player', name: 'Josh Allen' },
        { type: 'pick', name: '2026 Round 2', pickYear: 2026, pickRound: 2 },
        { type: 'pick', name: 'Mystery pick' },
      ]),
    ).toEqual({
      assets: [
        { kind: 'player', name: 'Josh Allen' },
        { kind: 'pick', year: 2026, round: 2, label: '2026 Round 2' },
      ],
      unpriceable: ['Mystery pick'],
    })
  })
})
