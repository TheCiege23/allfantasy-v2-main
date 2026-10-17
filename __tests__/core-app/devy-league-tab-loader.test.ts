// @vitest-environment node
/**
 * `loadDevyLeagueTab` — the per-league Devy tab's data, DB-first.
 *
 * The tab shipped with every section hard-coded empty (`freeAgents=[]`, `draftBoard=[]`, slots all
 * `player: null`). These pin what each section now reads, that "held" means what the one trade grade
 * means by it, that the trade value IS the grade's number, and that every empty section says why
 * instead of stating a fact it cannot know.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  league: { sport: 'NFL', season: 2026 } as Row | null,
  team: { id: 't-me', platformUserId: 'sl-me', externalId: '1', claimedByUserId: 'u1' } as Row | null,
  teams: [] as Row[],
  rosters: [] as Row[],
  rights: [] as Row[],
  players: [] as Row[],
  session: null as Row | null,
  picks: [] as Row[],
  news: [] as Row[],
  fail: new Set<string>(),
  calls: {} as Record<string, unknown[]>,
}))

function gate<T>(name: string, fn: (args: any) => T) {
  return vi.fn(async (args: any) => {
    ;(db.calls[name] ??= []).push(args)
    if (db.fail.has(name)) throw new Error(`${name} down`)
    return fn(args)
  })
}

/** Just enough of Prisma's `where` for the queries under test. */
function matchPlayer(p: Row, where: any): boolean {
  if (!where) return true
  if (where.id?.in && !where.id.in.includes(p.id)) return false
  if (where.id?.notIn && where.id.notIn.includes(p.id)) return false
  if (where.sport != null && p.sport !== where.sport) return false
  if (where.devyEligible != null && p.devyEligible !== where.devyEligible) return false
  if (where.graduatedToNFL != null && p.graduatedToNFL !== where.graduatedToNFL) return false
  if (where.draftProjectionScore?.not === null && p.draftProjectionScore == null) return false
  if (where.devyAdp?.not === null && p.devyAdp == null) return false
  return true
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: gate('league', () => db.league) },
    leagueTeam: {
      findFirst: gate('leagueTeam.findFirst', () => db.team),
      findMany: gate('leagueTeam.findMany', () => db.teams),
    },
    roster: {
      findFirst: gate('roster.findFirst', (a) => db.rosters.find((r) => a.where.platformUserId.in.includes(r.platformUserId)) ?? null),
      findMany: gate('roster.findMany', (a) =>
        a.where.id?.in ? db.rosters.filter((r) => a.where.id.in.includes(r.id)) : db.rosters.filter((r) => r.leagueId === a.where.leagueId),
      ),
    },
    devyRights: {
      findMany: gate('devyRights', (a) =>
        db.rights.filter((r) => r.leagueId === a.where.leagueId && !a.where.state.notIn.includes(r.state)),
      ),
    },
    devyPlayer: {
      findMany: gate('devyPlayer', (a) => {
        let rows = db.players.filter((p) => matchPlayer(p, a.where))
        const key = a.orderBy ? Object.keys(a.orderBy)[0]! : null
        if (key) {
          const dir = a.orderBy[key] === 'asc' ? 1 : -1
          rows = [...rows].sort((x, y) => ((x[key] as number) - (y[key] as number)) * dir)
        }
        return a.take ? rows.slice(0, a.take) : rows
      }),
    },
    draftSession: { findFirst: gate('draftSession', () => db.session) },
    draftPick: { findMany: gate('draftPick', (a) => db.picks.filter((p) => p.round === a.where.round)) },
    sportsNews: {
      findFirst: gate('news.findFirst', () =>
        [...db.news].sort((a, b) => (b.publishedAt as Date).getTime() - (a.publishedAt as Date).getTime())[0] ?? null,
      ),
      findMany: gate('news.findMany', (a) =>
        db.news
          .filter((n) => (n.publishedAt as Date).getTime() >= a.where.publishedAt.gte.getTime())
          .sort((x, y) => (y.publishedAt as Date).getTime() - (x.publishedAt as Date).getTime()),
      ),
    },
  },
}))

import { DEVY_TAB_COPY, loadDevyLeagueTab, readDevyRounds, staleNewsReason } from '@/lib/core-app/devyLeagueTab'
import { devyOptionValue } from '@/lib/devy/devyOptionValue'
import { DEVY_BASIS_NOTE } from '@/lib/decision-os/trade/leagueAssetRules'

const NOW = new Date('2026-09-29T12:00:00Z')
const L = 'L1'

function prospect(id: string, name: string, extra: Row = {}): Row {
  return {
    id,
    name,
    position: 'WR',
    school: 'Ohio State',
    sport: 'NCAAF',
    devyEligible: true,
    graduatedToNFL: false,
    headshotUrl: null,
    draftProjectionScore: 50,
    devyAdp: null,
    ppaSeasonTotal: null,
    recruitingComposite: null,
    recruitingStars: null,
    draftEligibleYear: null,
    ...extra,
  }
}

const SMITH = prospect('p-smith', 'Jeremiah Smith', {
  ppaSeasonTotal: 60,
  recruitingComposite: 0.9999,
  recruitingStars: 5,
  draftEligibleYear: 2027,
  draftProjectionScore: 95,
})

function load(devySlotCount = 3) {
  return loadDevyLeagueTab({ leagueId: L, userId: 'u1', devySlotCount, now: NOW })
}

beforeEach(() => {
  db.league = { sport: 'NFL', season: 2026 }
  db.team = { id: 't-me', platformUserId: 'sl-me', externalId: '1', claimedByUserId: 'u1' }
  db.teams = [
    { id: 't-me', externalId: '1', platformUserId: 'sl-me', claimedByUserId: 'u1', teamName: 'My Team', ownerName: 'me' },
    { id: 't-2', externalId: '2', platformUserId: 'sl-2', claimedByUserId: null, teamName: 'Gridiron Gang', ownerName: 'rival' },
  ]
  db.rosters = [
    { id: 'r-me', leagueId: L, platformUserId: 'sl-me', playerData: { players: [] } },
    { id: 'r-2', leagueId: L, platformUserId: 'sl-2', playerData: { players: [] } },
  ]
  db.rights = []
  db.players = []
  db.session = null
  db.picks = []
  db.news = []
  db.fail = new Set()
  db.calls = {}
})

describe('slots — the viewer’s held prospects, from DevyRights on THEIR roster', () => {
  it('fills my slots with my prospects, leaves the rest empty, and never shows a rival’s prospect as mine', async () => {
    db.players = [SMITH, prospect('p-b', 'Bryce Underwood', { position: 'QB', school: 'Michigan' })]
    db.rights = [
      { leagueId: L, rosterId: 'r-me', devyPlayerId: 'p-smith', state: 'NCAA_DEVY_ACTIVE' },
      { leagueId: L, rosterId: 'r-2', devyPlayerId: 'p-b', state: 'NCAA_DEVY_ACTIVE' },
    ]
    const out = await load(3)
    expect(out.slots).toHaveLength(3)
    expect(out.slots[0]!.player).toMatchObject({ name: 'Jeremiah Smith', position: 'WR', school: 'Ohio State' })
    expect(out.slots.slice(1).every((s) => s.player === null)).toBe(true)
    expect(out.slots.map((s) => s.player?.name)).not.toContain('Bryce Underwood')
    expect(out.emptyReasons?.slots).toBeUndefined()
  })

  it('🛑 an imported league with no recorded rights says so — no invented names, no silent blanks', async () => {
    db.players = [SMITH]
    const out = await load(2)
    expect(out.slots.every((s) => s.player === null)).toBe(true)
    expect(out.emptyReasons?.slots).toBe(DEVY_TAB_COPY.noRights)
  })

  it('tells "no team claimed" apart from "no roster imported"', async () => {
    db.team = null
    expect((await load()).emptyReasons?.slots).toBe(DEVY_TAB_COPY.noTeamClaimed)
    db.team = { id: 't-me', platformUserId: 'nobody', externalId: '99', claimedByUserId: 'u1' }
    db.rosters = []
    expect((await load()).emptyReasons?.slots).toBe(DEVY_TAB_COPY.noRoster)
  })

  it('promoted and expired rights are not held — and a graduated prospect is not a slot', async () => {
    db.players = [SMITH, prospect('p-grad', 'Old Senior', { graduatedToNFL: true })]
    db.rights = [
      { leagueId: L, rosterId: 'r-me', devyPlayerId: 'p-smith', state: 'PROMOTED_TO_PRO' },
      { leagueId: L, rosterId: 'r-me', devyPlayerId: 'p-grad', state: 'NCAA_DEVY_ACTIVE' },
    ]
    const out = await load(2)
    expect(out.slots.every((s) => s.player === null)).toBe(true)
    expect(db.calls.devyRights![0]).toMatchObject({ where: { state: { notIn: ['PROMOTED_TO_PRO', 'RIGHTS_EXPIRED'] } } })
  })
})

describe('free agents — devy-eligible NCAAF prospects nobody in THIS league holds', () => {
  it('excludes prospects held by any team here, keeps ones held only in another league, and reads NCAAF only', async () => {
    db.players = [
      SMITH,
      prospect('p-b', 'Bryce Underwood', { draftProjectionScore: 90 }),
      prospect('p-other', 'Other League Guy', { draftProjectionScore: 80 }),
      prospect('p-hoops', 'Hoops Prospect', { sport: 'NCAAB', draftProjectionScore: 99 }),
      prospect('p-unscored', 'Unscored Kid', { draftProjectionScore: null }),
    ]
    db.rights = [
      { leagueId: L, rosterId: 'r-2', devyPlayerId: 'p-b', state: 'NCAA_DEVY_ACTIVE' },
      { leagueId: 'OTHER', rosterId: 'r-x', devyPlayerId: 'p-other', state: 'NCAA_DEVY_ACTIVE' },
    ]
    const out = await load()
    expect(out.freeAgents.map((f) => f.name)).toEqual(['Jeremiah Smith', 'Other League Guy'])
    expect(out.freeAgents[0]).toMatchObject({ grade: 95, position: 'WR', school: 'Ohio State' })
  })

  it('🛑 does not list a single prospect as a free agent when the held set could not be read', async () => {
    db.players = [SMITH]
    db.fail.add('devyRights')
    const out = await load()
    expect(out.freeAgents).toEqual([])
    expect(out.emptyReasons?.freeAgents).toBe(DEVY_TAB_COPY.freeAgentsFailed)
    expect(out.emptyReasons?.slots).toBe(DEVY_TAB_COPY.slotsFailed)
  })

  it('an empty pool says so rather than claiming everyone is rostered', async () => {
    const out = await load()
    expect(out.emptyReasons?.freeAgents).toBe(DEVY_TAB_COPY.noFreeAgents)
  })
})

describe('trade values — the one trade grade’s own price for each held prospect', () => {
  it('🛑 quotes devyOptionValue for the league season, labels the holder, and invents no trend', async () => {
    db.players = [SMITH, prospect('p-te', 'Unmeasured End', { position: 'TE' })]
    db.rights = [
      { leagueId: L, rosterId: 'r-2', devyPlayerId: 'p-te', state: 'NCAA_DEVY_ACTIVE' },
      { leagueId: L, rosterId: 'r-me', devyPlayerId: 'p-smith', state: 'NCAA_DEVY_ACTIVE' },
    ]
    const expected = devyOptionValue({
      name: 'Jeremiah Smith',
      position: 'WR',
      ppaSeasonTotal: 60,
      recruitingComposite: 0.9999,
      recruitingStars: 5,
      draftEligibleYear: 2027,
      currentSeason: 2026,
    }).value
    expect(expected).toBeGreaterThan(0)
    const out = await load()
    expect(out.tradeValues).toEqual([
      { id: 'p-smith', player: 'Jeremiah Smith', value: expected, trend: null, status: 'Rostered · You' },
      // Unmeasured is listed, as null — never zero, never dropped — and after every priced row.
      { id: 'p-te', player: 'Unmeasured End', value: null, trend: null, status: 'Rostered · Gridiron Gang' },
    ])
    expect(out.tradeValueNote).toBe(DEVY_BASIS_NOTE)
  })

  it('prices nothing outside an NFL league, or without a season to measure the wait from', async () => {
    db.players = [SMITH]
    db.rights = [{ leagueId: L, rosterId: 'r-me', devyPlayerId: 'p-smith', state: 'NCAA_DEVY_ACTIVE' }]
    db.league = { sport: 'NBA', season: 2026 }
    let out = await load()
    expect(out.tradeValues).toEqual([])
    expect(out.emptyReasons?.tradeValues).toBe(DEVY_TAB_COPY.notNfl)
    db.league = { sport: 'NFL', season: null }
    out = await load()
    expect(out.emptyReasons?.tradeValues).toBe(DEVY_TAB_COPY.noSeason)
  })

  it('no held prospect → no values, with the grade’s own reason', async () => {
    const out = await load()
    expect(out.tradeValues).toEqual([])
    expect(out.tradeValueNote).toBeNull()
    expect(out.emptyReasons?.tradeValues).toBe(DEVY_TAB_COPY.noHeld)
  })
})

describe('draft board — the live devy round when one is set, else best available by devy ADP', () => {
  it('orders the devy round through the draft engine (snake + a traded pick) and marks drafted / on the clock', async () => {
    db.session = {
      id: 's1',
      status: 'in_progress',
      draftType: 'snake',
      teamCount: 3,
      thirdRoundReversal: false,
      slotOrder: [
        { slot: 1, rosterId: 'r-a', displayName: 'Alpha' },
        { slot: 2, rosterId: 'r-b', displayName: 'Bravo' },
        { slot: 3, rosterId: 'r-c', displayName: 'Charlie' },
      ],
      tradedPicks: [{ round: 2, originalRosterId: 'r-a', previousOwnerName: 'Alpha', newRosterId: 'r-b', newOwnerName: 'Bravo' }],
      devyConfig: { enabled: true, devyRounds: [2] },
      currentRoundNum: 2,
      nextOverallPick: 5,
    }
    db.picks = [{ round: 2, overall: 4, playerName: 'Arch Manning', position: 'QB' }]
    const out = await load()
    expect(out.draftRoundLabel).toBe('Round 2')
    expect(out.draftCountdown).toBe('Live')
    expect(out.draftBoard).toEqual([
      // Round 2 of a snake runs 3, 2, 1 — and Alpha's round-2 pick now belongs to Bravo.
      { id: 'pick-4', label: 'R2 · P1', team: 'Charlie', status: 'drafted', selection: 'Arch Manning · QB' },
      { id: 'pick-5', label: 'R2 · P2', team: 'Bravo', status: 'on-the-clock', selection: null },
      { id: 'pick-6', label: 'R2 · P3', team: 'Bravo', status: 'upcoming', selection: null },
    ])
    expect(out.draftProspects).toEqual([])
  })

  it('with no devy draft, lists unheld prospects by ADP and says what the board is built from', async () => {
    db.players = [
      prospect('p1', 'Later Pick', { devyAdp: 9.5 }),
      prospect('p2', 'Top Pick', { devyAdp: 1.2, school: 'Texas', position: 'QB' }),
      prospect('p3', 'Held Here', { devyAdp: 0.5 }),
      prospect('p4', 'No Adp', { devyAdp: null }),
    ]
    db.rights = [{ leagueId: L, rosterId: 'r-2', devyPlayerId: 'p3', state: 'NCAA_DEVY_ACTIVE' }]
    const out = await load()
    expect(out.draftBoard).toEqual([])
    expect(out.draftProspects).toEqual([
      { id: 'p2', adp: 1.2, name: 'Top Pick', position: 'QB', school: 'Texas' },
      { id: 'p1', adp: 9.5, name: 'Later Pick', position: 'WR', school: 'Ohio State' },
    ])
    expect(out.draftBoardNote).toBe(DEVY_TAB_COPY.adpNote)
  })

  it('a session without devy rounds is not a devy draft; nothing at all says so', async () => {
    db.session = { id: 's1', status: 'pre_draft', draftType: 'snake', teamCount: 3, thirdRoundReversal: false, slotOrder: [], tradedPicks: [], devyConfig: null, currentRoundNum: 1, nextOverallPick: 1 }
    const out = await load()
    expect(out.draftBoard).toEqual([])
    expect(out.draftProspects).toEqual([])
    expect(out.emptyReasons?.draftBoard).toBe(DEVY_TAB_COPY.noBoard)
  })

  it('readDevyRounds takes only an enabled config with real round numbers', () => {
    expect(readDevyRounds({ enabled: true, devyRounds: [15, 14, 14, 0, 'x'] })).toEqual([14, 15])
    expect(readDevyRounds({ enabled: false, devyRounds: [1] })).toBeNull()
    expect(readDevyRounds(null)).toBeNull()
  })
})

describe('news — only from a fresh feed, only about prospects on this tab', () => {
  const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000)

  it('🛑 a stale feed shows nothing and says how old it is', async () => {
    db.players = [SMITH]
    db.news = [{ id: 'n1', title: 'Jeremiah Smith dominates again', description: null, category: null, publishedAt: at(24 * 6) }]
    const out = await load()
    expect(out.news).toEqual([])
    expect(out.emptyReasons?.news).toBe(staleNewsReason('6d ago'))
  })

  it('a fresh feed shows articles naming a prospect here — matched on the text, whole words only', async () => {
    db.players = [SMITH]
    db.news = [
      { id: 'n1', title: 'Jeremiah Smith hauls in three scores', description: null, category: 'Performance', publishedAt: at(2) },
      { id: 'n2', title: 'Jeremiah Smithson commits to Oregon', description: null, category: null, publishedAt: at(1) },
      { id: 'n3', title: 'Coaching carousel heats up', description: null, category: null, publishedAt: at(1) },
    ]
    const out = await load()
    expect(out.news).toEqual([{ id: 'n1', kind: 'breakout', player: 'Jeremiah Smith', blurb: 'Jeremiah Smith hauls in three scores', age: '2h ago' }])
    expect(out.emptyReasons?.news).toBeUndefined()
  })

  it('fresh but about nobody here → an honest line, not general headlines', async () => {
    db.players = [SMITH]
    db.news = [{ id: 'n3', title: 'Coaching carousel heats up', description: null, category: null, publishedAt: at(1) }]
    const out = await load()
    expect(out.news).toEqual([])
    expect(out.emptyReasons?.news).toBe(DEVY_TAB_COPY.noProspectNews)
  })

  it('no college news at all', async () => {
    expect((await load()).emptyReasons?.news).toBe(DEVY_TAB_COPY.noNewsOnFile)
  })
})

it('never throws, and reads no provider — every section degrades to a reason', async () => {
  for (const name of ['league', 'leagueTeam.findFirst', 'devyRights', 'devyPlayer', 'draftSession', 'news.findFirst']) db.fail.add(name)
  const out = await load(2)
  expect(out.slots).toHaveLength(2)
  expect(out.emptyReasons).toMatchObject({
    slots: DEVY_TAB_COPY.slotsFailed,
    freeAgents: DEVY_TAB_COPY.freeAgentsFailed,
    draftBoard: DEVY_TAB_COPY.boardFailed,
    tradeValues: DEVY_TAB_COPY.valuesFailed,
    news: DEVY_TAB_COPY.newsFailed,
  })
})
