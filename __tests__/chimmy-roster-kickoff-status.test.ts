import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueFindMany: vi.fn(),
  games: vi.fn(),
  team: vi.fn(),
  leagues: vi.fn(),
  identities: vi.fn(),
  injuries: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique, findMany: h.leagueFindMany },
    sportsGame: { findMany: h.games },
  },
}))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveAiTeamContext: h.team }))
vi.mock('@/lib/chimmy/tools/leagueByName', () => ({ listMemberLeagues: h.leagues }))
vi.mock('@/lib/player-identity/resolveRosterPlayerIdentities', () => ({ resolveRosterPlayerIdentities: h.identities }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.injuries }))

import { buildMyRosterContext } from '@/lib/chimmy/tools/myRosterTool'
import { buildMyRosterInjuriesContext } from '@/lib/chimmy/tools/myRosterInjuriesTool'
import { kickoffStatusLine, LINEUP_ACTION_RULES } from '@/lib/chimmy/lineupActionEvidence'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

/*
 * The 2026-09-28 KBFL baseline, frozen: the question was sent at 02:03:23Z. Daniels' game (WAS vs
 * SEA) kicked off at 17:00Z and Johnson's (NO vs LV) at 20:25Z — both long before — and Chimmy still
 * offered a TE swap for Johnson's slot. The checker under test is the REAL `checkStartedGames`;
 * only the schedule table is mocked.
 */
const ASKED_AT = new Date('2026-09-28T02:03:23.380Z')
const SCHEDULE = [
  { homeTeam: 'WAS', awayTeam: 'SEA', homeTeamId: null, awayTeamId: null, startTime: new Date('2026-09-27T17:00:00Z'), status: 'final' },
  { homeTeam: 'NO', awayTeam: 'LV', homeTeamId: null, awayTeamId: null, startTime: new Date('2026-09-27T20:25:00Z'), status: 'final' },
  { homeTeam: 'DAL', awayTeam: 'CHI', homeTeamId: null, awayTeamId: null, startTime: new Date('2026-09-29T00:15:00Z'), status: 'scheduled' },
]

const ref = (playerId: string, name: string, position: string, team: string | null, injuryStatus: string | null = null) =>
  ({ playerId, name, position, team, injuryStatus })

const DANIELS = ref('11566', 'Jayden Daniels', 'QB', 'WAS', 'Out')
const JOHNSON = ref('7002', 'Juwan Johnson', 'TE', 'NO', 'Out')
const LAMB = ref('6786', 'CeeDee Lamb', 'WR', 'DAL')
const NOTEAM = ref('9999', 'Free Agent Guy', 'WR', null)

function team(starters: unknown[]) {
  return {
    schemaVersion: 1 as const, teamId: 't1', teamName: '(F) New York BroVengers', platformUserId: 'p1',
    record: { wins: 0, losses: 2, ties: 0 }, standingRank: 9, pointsFor: 200, rosterPlayerCount: starters.length,
    starters, bench: [ref('5000', 'Austin Hooper', 'TE', 'NE')], injuredReserve: [], taxi: [],
    opponentThisPeriod: null, dataGaps: [],
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(ASKED_AT)
  h.leagueFindUnique.mockResolvedValue({ sport: 'NFL', season: 2026, name: 'KBFL' })
  h.games.mockResolvedValue(SCHEDULE)
})
afterEach(() => vi.useRealTimers())

describe('kickoffStatusLine', () => {
  const starters = [{ playerId: 'a', name: 'A' }, { playerId: 'b', name: 'B' }, { playerId: 'c', name: 'C' }]

  it('sorts starters into started, not started and unverified', () => {
    const line = kickoffStatusLine(starters, { started: new Map([['a', "A's game has already started"]]), unverified: ['c'] }, ASKED_AT)!
    expect(line).toContain("GAME STARTED (1): A's game has already started.")
    expect(line).toContain('NOT STARTED (1): B.')
    expect(line).toContain('KICKOFF UNVERIFIED (1): C')
    expect(line).toContain('checked 2026-09-28T02:03:23.380Z')
  })

  it('a failed schedule read makes every starter unverified, never not started', () => {
    const line = kickoffStatusLine(starters, null, ASKED_AT)!
    expect(line).toContain('KICKOFF UNVERIFIED (3): A, B, C')
    expect(line).not.toContain('NOT STARTED')
  })

  it('reports nothing when there are no starters', () => {
    expect(kickoffStatusLine([], null, ASKED_AT)).toBeNull()
  })
})

describe('get_my_roster kickoff status (KBFL baseline)', () => {
  it('marks Daniels and Johnson GAME STARTED, a Monday-night starter NOT STARTED, and a teamless one unverified', async () => {
    h.team.mockResolvedValue(team([DANIELS, JOHNSON, LAMB, NOTEAM, ref('0', '', 'FLEX', null)]))
    const out = await buildMyRosterContext('kbfl', 'viewer')

    const line = out.split('\n').find((l) => l.startsWith('KICKOFF STATUS'))!
    expect(line).toMatch(/GAME STARTED \(2\): Jayden Daniels's game \(SEA at WAS\) has already started; Juwan Johnson's game \(LV at NO\) has already started\./)
    expect(line).toContain('NOT STARTED (1): CeeDee Lamb.')
    expect(line).toContain('KICKOFF UNVERIFIED (1): Free Agent Guy')
    /* The empty slot "0" is a hole, not a player, and is never sent to the checker. */
    expect(out).not.toMatch(/unnamed player 0/)
  })

  it('a schedule read that throws leaves every starter unverified', async () => {
    h.team.mockResolvedValue(team([DANIELS, JOHNSON]))
    h.games.mockRejectedValue(new Error('db down'))
    const out = await buildMyRosterContext('kbfl', 'viewer')
    const line = out.split('\n').find((l) => l.startsWith('KICKOFF STATUS'))!
    expect(line).toContain('KICKOFF UNVERIFIED (2): Jayden Daniels, Juwan Johnson')
    expect(line).not.toContain('GAME STARTED (')
    expect(line).not.toContain('NOT STARTED (')
  })
})

describe('get_my_injuries ROSTER PLACEMENT kickoff status (KBFL baseline)', () => {
  it('annotates each Out starter with whether his game has started', async () => {
    h.leagues.mockResolvedValue([{ id: 'kbfl', name: 'KBFL', sport: 'NFL', season: 2026 }])
    h.leagueFindMany.mockResolvedValue([{ id: 'kbfl', platform: 'sleeper', settings: {}, leagueType: 'dynasty' }])
    h.team.mockResolvedValue(team([DANIELS, JOHNSON, ref('8000', 'Dak Prescott', 'QB', 'DAL')]))
    const fact = (status: string) => ({
      playerName: 'x', status, type: null, description: null, date: ASKED_AT, week: null, source: 'rolling_insights',
      fetchedAt: ASKED_AT, reportedAt: ASKED_AT, ageHours: 1, fetchAgeHours: 1, stale: false,
    })
    h.injuries.mockResolvedValue({
      byPlayer: new Map([
        [normalizeMatchName('Jayden Daniels'), fact('Out')],
        [normalizeMatchName('Juwan Johnson'), fact('Out')],
        [normalizeMatchName('Dak Prescott'), fact('Out')],
      ]),
      ambiguous: [], newestFetchedAt: ASKED_AT, feedStale: false, coverage: { sourceAvailable: true, reason: null },
    })

    const out = await buildMyRosterInjuriesContext({ userId: 'viewer', leagueId: 'kbfl' })
    const placement = out.split('\n').find((l) => l.startsWith('ROSTER PLACEMENT'))!
    expect(placement).toContain("Jayden Daniels (KBFL) — GAME STARTED: Jayden Daniels's game (SEA at WAS) has already started")
    expect(placement).toContain("Juwan Johnson (KBFL) — GAME STARTED: Juwan Johnson's game (LV at NO) has already started")
    expect(placement).toContain('Dak Prescott (KBFL) — NOT STARTED')
    expect(placement).toContain('Kickoff is from the AllFantasy game schedule (checked 2026-09-28T02:03:23.380Z)')
    expect(placement).toContain(LINEUP_ACTION_RULES)
    /* One schedule read for the sport, not one per player. */
    expect(h.games).toHaveBeenCalledTimes(1)
  })
})

describe('the rule the answer is held to', () => {
  it('forbids offering a swap for a starter whose game has started', () => {
    expect(LINEUP_ACTION_RULES).toContain('When a tool marks a starter GAME STARTED, treat his slot as locked for this week')
    expect(LINEUP_ACTION_RULES).toContain('never list benching, swapping or replacing him as a move still open this week')
    expect(LINEUP_ACTION_RULES).toContain('never call his slot fixable')
  })
})
