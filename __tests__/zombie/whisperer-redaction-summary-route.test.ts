// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const W_ROSTER = 'roster-w-91'
const W_USER = 'user-whisperer-91'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  resolveWhispererViewer: vi.fn(),
  loadNativeWeekResults: vi.fn(),
  zombieTeams: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => 'roster-2'),
}))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({
  isZombieLeague: vi.fn(async () => true),
  getZombieLeagueConfig: vi.fn(async () => ({
    whispererSelection: 'random',
    infectionLossToWhisperer: true,
    infectionLossToZombie: true,
    serumReviveCount: 1,
    zombieTradeBlocked: true,
  })),
}))
vi.mock('@/lib/zombie/ZombieOwnerStatusService', () => ({
  getWhispererRosterId: vi.fn(async () => W_ROSTER),
  getAllStatuses: vi.fn(async () => [
    { rosterId: W_ROSTER, status: 'Whisperer' },
    { rosterId: 'roster-2', status: 'Survivor' },
    { rosterId: 'roster-3', status: 'Zombie' },
  ]),
}))
vi.mock('@/lib/zombie/ZombieWeeklyBoardService', () => ({
  getWeeklyBoardData: vi.fn(async () => ({ survivors: ['roster-2'], zombies: ['roster-3'], movementWatch: [] })),
}))
vi.mock('@/lib/zombie/ZombieSerumEngine', () => ({ getSerumBalance: vi.fn(async () => 0) }))
vi.mock('@/lib/zombie/ZombieAmbushEngine', () => ({ getAmbushBalance: vi.fn(async () => 0) }))
vi.mock('@/lib/zombie/ZombieInfectionEngine', () => ({ loadNativeWeekResults: hm.loadNativeWeekResults }))
vi.mock('@/lib/zombie/zombieRules', () => ({
  getZombieRulesForSport: vi.fn(async () => ({
    sport: 'NBA',
    bashingThreshold: 128,
    maulingThreshold: 211,
    weaponShieldThreshold: 900,
    weaponAmbushThreshold: 1050,
    weaponAxeMargin: 90,
    reviveThreshold: 3,
    serumMaxHold: 5,
    lineupLockDesc: null,
  })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({
        name: 'Tip-Off Outbreak',
        zombieLeague: {
          universeId: null,
          sport: 'NBA',
          season: 2026,
          currentWeek: 3,
          totalWeeks: 24,
          themeLabel: null,
          status: 'active',
        },
      })),
    },
    // Deliberately NOT in team order: names must come from identity, not position.
    roster: {
      findMany: vi.fn(async () => [
        { id: 'roster-3', platformUserId: 'user-3', playerData: null, redraftRoster: null },
        { id: W_ROSTER, platformUserId: W_USER, playerData: null, redraftRoster: null },
        { id: 'roster-2', platformUserId: 'user-2', playerData: null, redraftRoster: null },
      ]),
    },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { id: 'lt-1', teamName: 'Team Nine', ownerName: null, externalId: 'x1', platformUserId: W_USER, claimedByUserId: null },
        { id: 'lt-2', teamName: 'Team Two', ownerName: null, externalId: 'x2', platformUserId: 'user-2', claimedByUserId: null },
        { id: 'lt-3', teamName: 'Team Three', ownerName: null, externalId: 'x3', platformUserId: 'user-3', claimedByUserId: null },
      ]),
    },
    zombieResourceLedger: { findMany: vi.fn(async () => []) },
    zombieWeeklyWinnings: { findMany: vi.fn(async () => [{ week: 2, amount: 300 }, { week: 3, amount: 412.5 }]) },
    zombieLeagueTeam: {
      findMany: hm.zombieTeams,
      findUnique: vi.fn(async () => ({
        ambushesRemaining: 0,
        items: [{ itemType: 'weapon_knife' }, { itemType: 'serum' }, { itemType: 'serum_revive' }],
      })),
    },
  },
}))
vi.mock('@/lib/zombie/whispererViewer', () => ({ resolveWhispererViewer: hm.resolveWhispererViewer }))

const IDENTITY = { rosterIds: new Set([W_ROSTER]), userIds: new Set([W_USER]) }

async function get() {
  const { GET } = await import('@/app/api/leagues/[leagueId]/zombie/summary/route')
  const res = await GET(new Request('http://localhost/api/leagues/league-1/zombie/summary?week=3'), {
    params: Promise.resolve({ leagueId: 'league-1' }),
  })
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

describe('GET /api/leagues/[leagueId]/zombie/summary — Whisperer secrecy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-2' } })
    // Week 3: the viewer (roster-2) plays the Whisperer; roster-3 was turned by the Whisperer this week.
    hm.loadNativeWeekResults.mockResolvedValue([
      { matchupId: 'm1', homeRosterId: 'roster-2', awayRosterId: W_ROSTER, homeScore: 980, awayScore: 1010, final: true },
    ])
    hm.zombieTeams.mockResolvedValue([
      { rosterId: W_ROSTER, status: 'Whisperer', revivedAt: null, weekBecameZombie: null, killedByRosterId: null },
      { rosterId: 'roster-2', status: 'Survivor', revivedAt: null, weekBecameZombie: null, killedByRosterId: null },
      { rosterId: 'roster-3', status: 'Zombie', revivedAt: null, weekBecameZombie: 3, killedByRosterId: W_ROSTER },
    ])
  })

  it('keeps a hidden Whisperer out of the matchup card and the weekly board', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: false, identity: IDENTITY })
    const res = await get()
    expect(res.body.myMatchup.opponentRosterId).toBe(W_ROSTER)
    expect(res.body.myMatchup.opponentStatus).toBe('Survivor')
    expect(res.body.weeklyBoard).toContainEqual({ kind: 'infection', victimRosterId: 'roster-3', infectorRosterId: null })
    expect(JSON.stringify(res.body.weeklyBoard)).not.toContain(W_ROSTER)
  })

  it('names the infector on the board to a viewer who may see the Whisperer', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: true, identity: IDENTITY })
    const res = await get()
    expect(res.body.myMatchup.opponentStatus).toBe('Whisperer')
    expect(res.body.weeklyBoard).toContainEqual({ kind: 'infection', victimRosterId: 'roster-3', infectorRosterId: W_ROSTER })
  })

  it('returns the home data: season, names by identity, team-item supplies, winnings and engine rules', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: false, identity: IDENTITY })
    const res = await get()
    expect(res.body.week).toBe(3)
    expect(res.body.league).toMatchObject({ sport: 'NBA', season: 2026, currentWeek: 3, totalWeeks: 24, teamCount: 3 })
    expect(typeof res.body.league.backgroundTheme).toBe('string')
    expect(res.body.rosterDisplayNames).toEqual({ 'roster-3': 'Team Three', [W_ROSTER]: 'Team Nine', 'roster-2': 'Team Two' })
    expect(res.body.myResources).toEqual({ serums: 2, weapons: 1, ambush: 0 })
    expect(res.body.myWinnings).toEqual({ week: 412.5, total: 712.5 })
    expect(res.body.myStatus).toBe('Survivor')
    expect(res.body.rules).toMatchObject({ bashingMargin: 128, maulingMargin: 211, knifeScore: 900, reviveSerums: 3, maulShare: 0.5, bashShare: 0.25 })
  })

  it('does not identify the Whisperer to a member of a secret league, by id, status or elimination', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: false, identity: IDENTITY })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.whispererRosterId).toBeNull()
    expect(res.body.whispererHidden).toBe(true)
    expect(res.text).not.toMatch(/"status":"Whisperer"/)
    expect(res.body.survivors).toContain(W_ROSTER)
    expect(res.body.zombies).not.toContain(W_ROSTER)
  })

  it('names the Whisperer to a viewer who may see it', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: true, identity: IDENTITY })
    const res = await get()
    expect(res.body.whispererRosterId).toBe(W_ROSTER)
    expect(res.body.whispererHidden).toBe(false)
  })
})
