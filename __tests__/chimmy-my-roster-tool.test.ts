import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  resolveTeam: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: h.leagueFindUnique } },
}))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({
  resolveAiTeamContext: h.resolveTeam,
}))

import { buildMyRosterContext } from '@/lib/chimmy/tools/myRosterTool'

const player = (name: string, over: Record<string, unknown> = {}) => ({
  playerId: name.toLowerCase().replace(/\s/g, '-'),
  name,
  position: 'WR',
  team: 'BUF',
  injuryStatus: null,
  ...over,
})

function team(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    teamId: 't1',
    teamName: 'TheCiege26',
    platformUserId: 'sleeper-1',
    record: { wins: 2, losses: 1, ties: 0 },
    standingRank: 3,
    pointsFor: 300,
    rosterPlayerCount: 3,
    starters: [player('Josh Allen', { position: 'QB' })],
    bench: [player('Khalil Shakir')],
    injuredReserve: [],
    taxi: [],
    opponentThisPeriod: null,
    dataGaps: [],
    ...over,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  h.leagueFindUnique.mockResolvedValue({ sport: 'NFL', season: 2026, name: 'KBFL' })
  h.resolveTeam.mockResolvedValue(team())
})

describe('buildMyRosterContext', () => {
  it('names the starters and bench with position and injury status', async () => {
    h.resolveTeam.mockResolvedValue(
      team({
        starters: [player('Josh Allen', { position: 'QB' })],
        bench: [player('Khalil Shakir', { injuryStatus: 'Questionable' })],
      }),
    )

    const out = await buildMyRosterContext('l1', 'u1')

    expect(out).toContain('STARTERS')
    expect(out).toContain('Josh Allen (QB BUF)')
    expect(out).toContain('BENCH')
    expect(out).toMatch(/Khalil Shakir.*Questionable/)
    expect(out).toContain('2-1')
  })

  /*
   * ⚠ NO PROJECTIONS EXIST IN THIS BLOCK, and a model handed a bare roster will
   * imply it ranked them unless told otherwise. Start percentages and snap share
   * are not stored anywhere in this repo.
   */
  it('states that it carries no projections or points', async () => {
    const out = await buildMyRosterContext('l1', 'u1')
    expect(out).toMatch(/no projections/i)
    expect(out).toMatch(/do NOT state projected points/i)
  })

  /*
   * ⚠ AN UNCLAIMED TEAM IS NOT AN EMPTY LEAGUE. Conflating them is how the model
   * told a commissioner his league had no data at all.
   */
  it('distinguishes an unclaimed team from an empty league', async () => {
    h.resolveTeam.mockResolvedValue(null)

    const out = await buildMyRosterContext('l1', 'u1')

    expect(out).toMatch(/not a statement that the league is empty/i)
    expect(out).toMatch(/claim their team/i)
    expect(out).toMatch(/do not name any players/i)
  })

  /* Claimed but unsynced is a third state, and must not be described as a lineup. */
  it('refuses to invent a lineup for a claimed but empty roster', async () => {
    h.resolveTeam.mockResolvedValue(
      team({ starters: [], bench: [], injuredReserve: [], taxi: [], rosterPlayerCount: 0 }),
    )

    const out = await buildMyRosterContext('l1', 'u1')

    expect(out).toMatch(/has not synced/i)
    expect(out).toMatch(/do NOT name players/i)
  })

  /* Gaps travel with the data — half a lineup looks whole otherwise. */
  it('passes known data gaps through verbatim', async () => {
    h.resolveTeam.mockResolvedValue(team({ dataGaps: ['4 players unresolved'] }))

    const out = await buildMyRosterContext('l1', 'u1')

    expect(out).toContain('KNOWN GAPS')
    expect(out).toContain('4 players unresolved')
  })

  it('says so when no league is selected, without reading anything', async () => {
    const out = await buildMyRosterContext('', 'u1')
    expect(out).toMatch(/no league is selected/i)
    expect(h.resolveTeam).not.toHaveBeenCalled()
  })

  it('survives an unreadable league', async () => {
    h.leagueFindUnique.mockResolvedValue(null)
    const out = await buildMyRosterContext('l1', 'u1')
    expect(out).toMatch(/could not be read/i)
  })

  /* A thrown resolver must come back as words, never as an exception. */
  it('never throws when the resolver fails', async () => {
    h.resolveTeam.mockRejectedValue(new Error('db down'))
    await expect(buildMyRosterContext('l1', 'u1')).resolves.toMatch(/no team/i)
  })

  it('caps very large groups rather than flooding the context', async () => {
    h.resolveTeam.mockResolvedValue(
      team({ bench: Array.from({ length: 45 }, (_, i) => player(`Player ${i}`)) }),
    )

    const out = await buildMyRosterContext('l1', 'u1')

    expect(out).toMatch(/\+15 more/)
  })
})
