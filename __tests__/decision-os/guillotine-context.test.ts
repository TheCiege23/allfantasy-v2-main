/**
 * The guillotine context loader (`lib/decision-os/trade/guillotineContext.ts`) against a stubbed database
 * shaped like Guillotine League 26 (1) on 2026-10-11: four FLEX and a SUPER_FLEX, a TE premium, rosters
 * holding Sleeper ids, chopped Sleeper teams as EMPTY rosters, and NFL projections keyed on identity ids
 * whose Rolling Insights numbers overlap Sleeper's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Snap = { playerId: string; playerName: string; position: string; season: number; computedAt: Date; adjustmentFactors: unknown; rosWeeksRemaining: number | null }
const db = vi.hoisted(() => ({
  snaps: [] as Snap[],
  identities: [] as Array<{ id: string; sleeperId: string | null; rollingInsightsId: string | null; espnId?: string }>,
  rosters: [] as Array<{ playerData: unknown; faabRemaining: number | null; redraftRosterId?: string }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    aFProjectionSnapshot: {
      // Honours the ordering asked for: a loader reading the highest season reads the wrong rows.
      findFirst: vi.fn(async ({ orderBy }: { orderBy: { computedAt?: 'desc'; season?: 'desc' } }) => {
        if (db.snaps.length === 0) return null
        const key = (s: Snap) => (orderBy.computedAt ? s.computedAt.getTime() : s.season)
        return { season: db.snaps.reduce((a, b) => (key(b) > key(a) ? b : a)).season }
      }),
      findMany: vi.fn(async ({ where }: { where: { season: number } }) => db.snaps.filter((s) => s.season === where.season)),
    },
    playerIdentityMap: {
      findMany: vi.fn(async ({ where, select }: { where: { id?: { in: string[] }; espnId?: { in: string[] } }; select: Record<string, boolean> }) =>
        db.identities.filter((i) => where.espnId ? where.espnId.in.includes(i.espnId ?? '') : where.id?.in.includes(i.id)).map((i) => Object.fromEntries(Object.keys(select).map((k) => [k, (i as Record<string, unknown>)[k]])))),
    },
    roster: { findMany: vi.fn(async () => db.rosters) },
  },
}))

import { loadGuillotineContext, loadZombiePlayerContext, leaguePointsPerGame } from '@/lib/decision-os/trade/guillotineContext'

import { gradeGuillotineDeal } from '@/lib/decision-os/trade/guillotineValue'

const SETTINGS = {
  roster_positions: ['FLEX', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN'],
  scoring_settings: { rec: 1, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6, pass_yd: 0.04, pass_td: 4, bonus_rec_te: 0.5 },
}
const RUN = new Date('2026-10-10T07:50:02Z')

function player(id: string, name: string, position: string, rates: Record<string, number>, sleeperId: string, ri: string | null = null, games = 5) {
  db.snaps.push({ playerId: id, playerName: name, position, season: 2026, computedAt: RUN, rosWeeksRemaining: 13,
    adjustmentFactors: { perGameRates: rates, confidenceReasons: [`${games} games in the season sample`], sourceSeason: 2026 } })
  db.identities.push({ id, sleeperId, rollingInsightsId: ri })
}
const roster = (ids: string[], faab: number | null) => db.rosters.push({ playerData: { players: ids, starters: [] }, faabRemaining: faab })
const league = { id: 'L', settings: SETTINGS, leagueSize: 18 }

beforeEach(() => {
  db.snaps = []
  db.identities = []
  db.rosters = []
})

describe('loadGuillotineContext', () => {
  it('matches rosters on Sleeper ids only — a Rolling Insights number that is someone else’s Sleeper id never hides a rostered star', async () => {
    // Production: Bijan Robinson is Sleeper 9509 and RI 7408; another player's Sleeper id is 7408.
    player('bijan', 'Bijan Robinson', 'RB', { rushing_yards: 120, rushing_touchdowns: 1, receptions: 3, receiving_yards: 25 }, '9509', '7408')
    player('other', 'Someone Else', 'WR', { receptions: 6, receiving_yards: 70 }, '7408', '9509')
    player('free', 'Free Agent', 'WR', { receptions: 4, receiving_yards: 50 }, '1111')
    player('free2', 'Free Two', 'WR', { receptions: 3, receiving_yards: 40 }, '2222')
    player('free3', 'Free Three', 'WR', { receptions: 2, receiving_yards: 30 }, '3333')
    roster(['9509'], 100)
    roster(['7408'], 50)
    const out = await loadGuillotineContext(league)
    if (!out.ok) throw new Error(out.reason)
    // Both rostered, so neither sets the free level: with two live teams, the third free agent does.
    expect(out.ctx.replacementBySlot.get('FLEX')?.name).toBe('Free Three')
  })

  it('uses only verified ESPN roster IDs in a saved ESPN league', async () => {
    player('a', 'ESPN A', 'WR', { receptions: 10 }, '22')
    player('b', 'ESPN B', 'WR', { receptions: 8 }, '11')
    player('collision', 'Wrong Sleeper Player', 'WR', { receptions: 3 }, '33')
    db.identities[0]!.espnId = '11'
    db.identities[1]!.espnId = '22'
    roster(['11'], 100)
    roster(['22'], 50)
    roster(['33'], 200)
    db.rosters[0]!.redraftRosterId = 'linked-1'
    db.rosters[1]!.redraftRosterId = 'linked-2'
    const imported = { ...league, leagueSize: 2, platform: 'espn', settings: { ...SETTINGS, roster_positions: ['WR:2', 'D/ST:1', 'BE:5', 'IR:1', 'FLEX:1'] } }
    const out = await loadGuillotineContext(imported)
    if (!out.ok) throw new Error(out.reason)
    expect(out.ctx.lineupLabel).toBe('2 WR, 1 DEF, 1 FLEX')
    expect(out.ctx.teamsAlive).toBe(2)
    expect(out.ctx.startingTeams).toBe(2)
    expect(out.ctx.liveFaab).toBe(150)
    const asset = (rosterPlayerId: string, playerId: string) => ({ kind: 'player' as const, rosterPlayerId, playerId })
    const give = [asset('11', 'b')]
    const get = [asset('22', 'a')]
    expect(gradeGuillotineDeal({ give, get, ctx: out.ctx })).toMatchObject({ graded: true, lines: [{ name: 'ESPN A' }, { name: 'ESPN B' }] })
    expect(gradeGuillotineDeal({ give: [asset('33', 'collision')], get, ctx: out.ctx })).toMatchObject({ graded: false, reason: expect.stringContaining('verified ESPN') })
    db.identities.push({ id: 'duplicate', sleeperId: null, rollingInsightsId: null, espnId: '11' })
    const ambiguous = await loadGuillotineContext(imported)
    if (!ambiguous.ok) throw new Error(ambiguous.reason)
    expect(ambiguous.ctx.espnRosterIndex?.has('11')).toBe(false)
  })

  it('reads a chopped Sleeper team (an empty roster) as gone: not alive, and its FAAB not live', async () => {
    player('a', 'A', 'WR', { receptions: 5, receiving_yards: 60 }, '1')
    player('b', 'B', 'WR', { receptions: 4, receiving_yards: 50 }, '2')
    roster(['1'], 120)
    roster(['2'], 80)
    roster([], 200)
    const out = await loadGuillotineContext(league)
    if (!out.ok) throw new Error(out.reason)
    expect(out.ctx.teamsAlive).toBe(2)
    expect(out.ctx.startingTeams).toBe(18)
    expect(out.ctx.liveFaab).toBe(200)
    expect(out.ctx.lineupLabel).toBe('4 FLEX, 1 SUPER_FLEX')
  })

  it('scores the league’s TE premium, which the stat scorer alone cannot see', () => {
    const rates = { receptions: 6, receiving_yards: 60 }
    const rules = SETTINGS.scoring_settings
    expect(leaguePointsPerGame(rates, rules, 'WR')).toBeCloseTo(6 + 6, 9)
    expect(leaguePointsPerGame(rates, rules, 'TE')).toBeCloseTo(6 + 6 + 3, 9)
  })

  it('reads the newest run, not the highest season on file', async () => {
    player('a', 'A', 'WR', { receptions: 5, receiving_yards: 60 }, '1')
    player('b', 'B', 'WR', { receptions: 4, receiving_yards: 50 }, '2')
    db.snaps.push({ playerId: 'stale', playerName: 'Stale', position: 'WR', season: 2027, computedAt: new Date('2026-09-01T00:00:00Z'), rosWeeksRemaining: 17, adjustmentFactors: { perGameRates: { receptions: 1 } } })
    roster(['1'], 10)
    roster(['2'], 10)
    const out = await loadGuillotineContext(league)
    if (!out.ok) throw new Error(out.reason)
    expect(out.ctx.board.map((p) => p.name).sort()).toEqual(['A', 'B'])
    expect(out.ctx.weeksLeft).toBe(13)
  })

  it('refuses rosters it cannot match, an unreadable lineup, and a league with one team left', async () => {
    player('a', 'A', 'WR', { receptions: 5 }, '1')
    roster(['espn-1', 'espn-2', '1'], 10)
    roster(['espn-3'], 10)
    expect(await loadGuillotineContext(league)).toMatchObject({ ok: false, reason: expect.stringMatching(/could not be matched/) })
    expect(await loadGuillotineContext({ ...league, settings: { scoring_settings: SETTINGS.scoring_settings } })).toMatchObject({ ok: false, reason: expect.stringMatching(/lineup/) })
    db.rosters = []
    roster(['1'], 10)
    roster([], 10)
    expect(await loadGuillotineContext(league)).toMatchObject({ ok: false, reason: expect.stringMatching(/Fewer than two/) })
  })
})

describe('loadZombiePlayerContext', () => {
  it('uses the best free agent and the full remaining season, while retaining every roster', async () => {
    player('a', 'Rostered A', 'WR', { receptions: 5, receiving_yards: 60 }, '1')
    player('b', 'Rostered B', 'WR', { receptions: 4, receiving_yards: 50 }, '2')
    player('free1', 'Best Free Agent', 'WR', { receptions: 3, receiving_yards: 40 }, '3')
    player('free2', 'Other Free Agent', 'WR', { receptions: 2, receiving_yards: 30 }, '4')
    roster(['1'], null)
    roster(['2'], null)
    roster([], null)
    const out = await loadZombiePlayerContext({ ...league, sport: 'NFL' })
    if (!out.ok) throw new Error(out.reason)
    expect(out.ctx.replacementBySlot.get('FLEX')?.name).toBe('Best Free Agent')
    expect(out.ctx.teamsAlive).toBe(3)
    expect(out.ctx.survival[0]).toBe(13)
    expect(out.ctx.releaseValue).toBe(0)
  })
})
