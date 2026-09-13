// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  isZombieLeague: vi.fn(),
  buildZombieAIContext: vi.fn(),
  zombieLeagueFindUnique: vi.fn(),
  getLeagueRole: vi.fn(),
}))

vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ isZombieLeague: hm.isZombieLeague }))
vi.mock('@/lib/zombie/ai/ZombieAIContext', () => ({ buildZombieAIContext: hm.buildZombieAIContext }))
vi.mock('@/lib/prisma', () => ({ prisma: { zombieLeague: { findUnique: hm.zombieLeagueFindUnique } } }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: hm.getLeagueRole }))

import { buildZombieContextForChimmy } from '@/lib/zombie/ai/zombieContextForChimmy'

const WHISPERER_ROSTER = 'roster-whisperer-77'
const WHISPERER_NAME = 'Quiet Menace'

function aiContext(overrides: Record<string, unknown> = {}) {
  return {
    leagueId: 'league-1',
    sport: 'NFL',
    week: 1,
    config: {
      whispererSelection: 'random',
      infectionLossToWhisperer: true,
      infectionLossToZombie: true,
      serumReviveCount: 2,
      zombieTradeBlocked: true,
    },
    whispererRosterId: WHISPERER_ROSTER,
    survivors: ['roster-me', 'roster-3'],
    zombies: ['roster-4'],
    statuses: [
      { rosterId: 'roster-me', status: 'Survivor' },
      { rosterId: WHISPERER_ROSTER, status: 'Whisperer' },
    ],
    movementWatch: [],
    rosterDisplayNames: { 'roster-me': 'My Team', [WHISPERER_ROSTER]: WHISPERER_NAME },
    myRosterId: 'roster-me',
    myResources: { serums: 1, weapons: 0, ambush: 0 },
    winningsByRoster: {},
    serumBalanceByRoster: {},
    weaponBalanceByRoster: {},
    chompinBlockCandidates: [],
    collusionFlags: [],
    dangerousDropFlags: [],
    historicalContext: null,
    ...overrides,
  }
}

function league(overrides: Record<string, unknown> = {}) {
  return {
    status: 'registering',
    currentWeek: 7,
    totalWeeks: 17,
    whispererIsPublic: false,
    whispererRecord: { isPubliclyRevealed: true },
    ...overrides,
  }
}

function expectWhispererHidden(prompt: string) {
  expect(prompt).not.toContain(WHISPERER_ROSTER)
  expect(prompt).not.toContain(WHISPERER_NAME)
  expect(prompt).toContain('Whisperer identity: hidden from this user')
}

describe('buildZombieContextForChimmy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.isZombieLeague.mockResolvedValue(true)
    hm.zombieLeagueFindUnique.mockResolvedValue(league())
    hm.buildZombieAIContext.mockImplementation(async ({ week }: { week: number }) => aiContext({ week }))
    hm.getLeagueRole.mockResolvedValue('member')
  })

  it('returns nothing for a league that is not a Zombie league', async () => {
    hm.isZombieLeague.mockResolvedValueOnce(false)
    expect(await buildZombieContextForChimmy('league-1', 'user-1')).toBe('')
    expect(hm.buildZombieAIContext).not.toHaveBeenCalled()
  })

  it('uses the league current week, not week 1', async () => {
    const prompt = await buildZombieContextForChimmy('league-1', 'user-1')
    expect(hm.buildZombieAIContext).toHaveBeenCalledWith({ leagueId: 'league-1', week: 7, userId: 'user-1' })
    expect(prompt).toContain('Week: 7 of 17.')
  })

  it('floors an unset current week to 1, like every other Zombie surface', async () => {
    hm.zombieLeagueFindUnique.mockResolvedValueOnce(league({ currentWeek: 0 }))
    await buildZombieContextForChimmy('league-1', 'user-1')
    expect(hm.buildZombieAIContext).toHaveBeenCalledWith(expect.objectContaining({ week: 1 }))
  })

  it('describes the league phase', async () => {
    hm.zombieLeagueFindUnique.mockResolvedValueOnce(league({ status: 'paused' }))
    const prompt = await buildZombieContextForChimmy('league-1', 'user-1')
    expect(prompt).toContain('Phase: Paused (status "paused").')
  })

  it('reports no current week before the season starts', async () => {
    hm.zombieLeagueFindUnique.mockResolvedValueOnce(league({ status: 'setup' }))
    const prompt = await buildZombieContextForChimmy('league-1', 'user-1')
    expect(prompt).toContain('Week: the season has not started.')
    expect(prompt).not.toContain('Week: 7')
  })

  it('hides the Whisperer from a member of a secret league', async () => {
    expectWhispererHidden(await buildZombieContextForChimmy('league-1', 'user-1'))
  })

  it('names the Whisperer to a member of a public league once revealed', async () => {
    hm.zombieLeagueFindUnique.mockResolvedValueOnce(league({ whispererIsPublic: true }))
    const prompt = await buildZombieContextForChimmy('league-1', 'user-1')
    expect(prompt).toContain(`Whisperer: ${WHISPERER_NAME}.`)
  })

  it('hides the Whisperer in a public league while unrevealed', async () => {
    hm.zombieLeagueFindUnique.mockResolvedValueOnce(
      league({ whispererIsPublic: true, whispererRecord: { isPubliclyRevealed: false } }),
    )
    expectWhispererHidden(await buildZombieContextForChimmy('league-1', 'user-1'))
  })

  it('names the Whisperer to the head commissioner of a secret league', async () => {
    hm.getLeagueRole.mockResolvedValueOnce('commissioner')
    const prompt = await buildZombieContextForChimmy('league-1', 'user-1')
    expect(prompt).toContain(`Whisperer: ${WHISPERER_NAME}.`)
  })

  it('does not treat a co-commissioner as the head commissioner', async () => {
    hm.getLeagueRole.mockResolvedValueOnce('co_commissioner')
    expectWhispererHidden(await buildZombieContextForChimmy('league-1', 'user-1'))
  })

  it('tells the Whisperer their own role privately', async () => {
    hm.buildZombieAIContext.mockImplementationOnce(async ({ week }: { week: number }) =>
      aiContext({ week, myRosterId: WHISPERER_ROSTER }),
    )
    const prompt = await buildZombieContextForChimmy('league-1', 'user-1')
    expect(prompt).toContain('The user is the Whisperer.')
    expect(prompt).not.toContain('hidden from this user')
  })

  it('fails closed on secrecy and phase when the Zombie league row is missing', async () => {
    hm.zombieLeagueFindUnique.mockResolvedValueOnce(null)
    const prompt = await buildZombieContextForChimmy('league-1', 'user-1')
    expectWhispererHidden(prompt)
    expect(prompt).toContain('Phase: unknown.')
    expect(prompt).toContain('Week: unknown.')
  })

  it('stays hidden when the role lookup fails', async () => {
    hm.getLeagueRole.mockRejectedValueOnce(new Error('db down'))
    expectWhispererHidden(await buildZombieContextForChimmy('league-1', 'user-1'))
  })
})
