/**
 * Format-aware Scout (War Room step 4d): elimination leagues show the cut and who is out, best ball
 * says there is no lineup to set, dynasty carries each team's future picks.
 *
 * The loader half runs against a mocked Prisma boundary; the screen half on rendered markup.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  teamFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  choppedFindMany: vi.fn(),
  eliminationFindMany: vi.fn(),
  matchupFindMany: vi.fn(),
  membership: vi.fn(),
  standings: vi.fn(),
  picks: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    leagueTeam: { findMany: h.teamFindMany },
    roster: { findMany: h.rosterFindMany },
    guillotineRosterState: { findMany: h.choppedFindMany },
    guillotineElimination: { findMany: h.eliminationFindMany },
    weeklyMatchup: { findMany: h.matchupFindMany },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/core-app/leagueStandings', () => ({ getLeagueStandings: h.standings }))
vi.mock('@/lib/dynasty-war-room/dynastyPickCapital', () => ({ loadDynastyPickCapital: h.picks }))
vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 5 })),
  resolveCurrentWeek: vi.fn(async () => null),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>{children as never}</a>
  ),
}))

import { getScoutData } from '@/lib/core-app/scout'
import { isEliminatedTeam } from '@/lib/core-app/eliminatedTeam'
import { Scout } from '@/components/core-app/screens/Scout'

const ME = 'user-1'
const team = (ext: string, over: Record<string, unknown> = {}) => ({
  id: `row-${ext}`, externalId: ext, ownerName: `Owner ${ext}`, teamName: `Team ${ext}`, avatarUrl: null, claimedByUserId: null, platformUserId: `su-${ext}`, ...over,
})
const roster = (ext: string, players: string[]) => ({ id: `r-${ext}`, platformUserId: `su-${ext}`, playerData: { players, starters: players } })

function league(over: Record<string, unknown>) {
  h.leagueFindUnique.mockResolvedValue({ id: 'lg1', name: 'The Axe', sport: 'NFL', platformLeagueId: 'p1', season: 2026, status: 'in_season', platform: 'sleeper', settings: {}, ...over })
}

beforeEach(() => {
  vi.resetAllMocks()
  h.membership.mockResolvedValue({ ok: true, access: { leagueId: 'lg1' } })
  h.standings.mockResolvedValue({ available: false, reason: 'no table', leagueName: 'x', history: [] })
  h.teamFindMany.mockResolvedValue([team('1', { claimedByUserId: ME, platformUserId: 'su-1' }), team('2'), team('3')])
  h.rosterFindMany.mockResolvedValue([roster('1', ['a']), roster('2', ['b']), roster('3', [])])
  h.choppedFindMany.mockResolvedValue([])
  h.eliminationFindMany.mockResolvedValue([])
  h.matchupFindMany.mockResolvedValue([{ rosterId: '1', matchupId: 1 }, { rosterId: '2', matchupId: 1 }])
})

describe('isEliminatedTeam — the one rule Game Plan and Scout share', () => {
  const base = { chopped: new Set<string>(), eliminated: new Set<string>(), elimination: true }
  it('reads the roster flag, a chopped row, or an elimination row, by any id', () => {
    expect(isEliminatedTeam({ ...base, playerData: { eliminated: true, players: ['a'] }, ids: [] })).toBe(true)
    expect(isEliminatedTeam({ ...base, playerData: { players: ['a'] }, ids: ['x', 'r-2'], chopped: new Set(['r-2']) })).toBe(true)
    expect(isEliminatedTeam({ ...base, playerData: { players: ['a'] }, ids: ['su-2'], eliminated: new Set(['su-2']) })).toBe(true)
  })
  it('counts an empty roster only in an elimination league — and a missing players key as empty, as the loader did', () => {
    expect(isEliminatedTeam({ ...base, playerData: { players: [] }, ids: [] })).toBe(true)
    expect(isEliminatedTeam({ ...base, playerData: {}, ids: [] })).toBe(true)
    expect(isEliminatedTeam({ ...base, elimination: false, playerData: { players: [] }, ids: [] })).toBe(false)
  })
  it('leaves a live team alone', () => {
    expect(isEliminatedTeam({ ...base, playerData: { players: ['a'] }, ids: ['r-1'] })).toBe(false)
  })
})

describe('Scout in an elimination league', () => {
  /*
   * The case the canonical resolver exists for: an older league with NO `leagueType` column and the
   * flag only in settings (2 of 14 elimination leagues, measured). A set column wins in the resolver,
   * and Scout follows the resolver so it cannot disagree with the rail's artwork.
   */
  it('detects the format from settings when the column is empty, as the canonical resolver does', async () => {
    league({ leagueType: null, settings: { guillotineMode: true } })
    const data = await getScoutData('lg1', ME)
    expect(data?.format.elimination).toBe(true)
  })

  it('marks the chopped team, with its week, and sorts it last', async () => {
    league({ guillotineMode: true })
    h.eliminationFindMany.mockResolvedValue([{ eliminatedRosterId: 'r-2', eliminatedOwnerId: 'su-2', scoringPeriod: 3, season: { season: 2026 } }])
    const data = await getScoutData('lg1', ME)
    if (!data?.managers.available) throw new Error('expected managers')
    const byId = Object.fromEntries(data.managers.data.map((m) => [m.managerId, m.eliminated]))
    expect(byId['2']).toEqual({ week: 3 })
    // Team 3 has an empty roster mid-season: out too, with no week on record.
    expect(byId['3']).toEqual({ week: null })
    expect(byId['1']).toBeNull()
    expect(data.managers.data.map((m) => m.managerId)[0]).toBe('1')
  })

  it('ignores an elimination from another season', async () => {
    league({ guillotineMode: true })
    h.rosterFindMany.mockResolvedValue([roster('1', ['a']), roster('2', ['b']), roster('3', ['c'])])
    h.eliminationFindMany.mockResolvedValue([{ eliminatedRosterId: 'r-2', eliminatedOwnerId: 'su-2', scoringPeriod: 9, season: { season: 2025 } }])
    const data = await getScoutData('lg1', ME)
    if (!data?.managers.available) throw new Error('expected managers')
    expect(data.managers.data.every((m) => m.eliminated === null)).toBe(true)
  })

  it('chops nobody before the draft, when every roster is empty', async () => {
    league({ guillotineMode: true, status: 'pre_draft' })
    h.rosterFindMany.mockResolvedValue([roster('1', []), roster('2', []), roster('3', [])])
    const data = await getScoutData('lg1', ME)
    if (!data?.managers.available) throw new Error('expected managers')
    expect(data.managers.data.every((m) => m.eliminated === null)).toBe(true)
  })

  it('names no THIS WEEK opponent, even when the provider published matchup ids', async () => {
    league({ guillotineMode: true })
    const data = await getScoutData('lg1', ME)
    expect(data?.opponent).toBeNull()
  })

  it('a redraft league reads no rosters or eliminations at all (the control)', async () => {
    league({ leagueType: 'redraft' })
    await getScoutData('lg1', ME)
    expect(h.rosterFindMany).not.toHaveBeenCalled()
    expect(h.eliminationFindMany).not.toHaveBeenCalled()
  })
})

describe('Scout in a dynasty league', () => {
  it('carries each team’s future picks from the dynasty War Room’s own reader', async () => {
    league({ isDynasty: true })
    h.picks.mockResolvedValue({
      picksByRosterId: new Map([
        ['r-2', [{ round: 1 }, { round: 2 }, { round: 4 }]],
        ['r-3', []],
      ]),
      state: 'partial',
      note: 'Only picks that changed hands are modeled.',
    })
    const data = await getScoutData('lg1', ME)
    if (!data?.managers.available) throw new Error('expected managers')
    const byId = Object.fromEntries(data.managers.data.map((m) => [m.managerId, m.picks]))
    expect(byId['2']).toEqual({ count: 3, early: 2 })
    expect(byId['3']).toEqual({ count: 0, early: 0 })
    expect(data.format.picks).toEqual({ state: 'partial', note: 'Only picks that changed hands are modeled.' })
  })
})

/* ── On screen ─────────────────────────────────────────────────────────── */

const fmt = (over: Record<string, unknown>) => ({ kind: 'redraft', elimination: false, bestBall: false, dynasty: false, picks: null, ...over })
const mgr = (id: string, over: Record<string, unknown> = {}) => ({ managerId: id, teamName: `Team ${id}`, ownerName: `Owner ${id}`, avatarUrl: null, isYou: false, isNextOpponent: false, standing: null, eliminated: null, picks: null, ...over })
const render = (data: Record<string, unknown>, standing: unknown = null) =>
  renderToStaticMarkup(
    <Scout
      data={{ league: { id: 'lg1', name: 'The Axe', sport: 'NFL' }, you: null, week: { seasonYear: 2026, week: 5 }, opponent: null, basis: { available: false, reason: 'x' }, ...data } as never}
      gamePlanHref="/p"
      matchupHref="/core/matchup?league=lg1"
      tradesHref="/t"
      eliminationStanding={standing as never}
    />,
  )

describe('Scout draws each format', () => {
  it('elimination: your rank against the cut, instead of an opponent', () => {
    const html = render(
      { format: fmt({ kind: 'guillotine', elimination: true }), managers: { available: true, data: [mgr('1', { isYou: true }), mgr('2')] } },
      { rank: 11, outOf: 12, overCut: 3.2, basis: 'projected', placesAboveCut: 1, cutLine: 60, elimination: true },
    )
    expect(html).toContain('Elimination week · week 5')
    expect(html).toContain('<strong>#11</strong> of 12 — 3.2 over the cut.')
    expect(html).toContain('Projected: no snap has been played yet.')
    expect(html).not.toContain('You have not played them')
  })

  it('elimination: says so when you are the one chopped', () => {
    const html = render({ format: fmt({ kind: 'guillotine', elimination: true }), managers: { available: true, data: [mgr('1', { isYou: true, eliminated: { week: 4 } })] } })
    expect(html).toContain('You were chopped in week 4.')
  })

  it('a chopped rival is tagged OUT with its week and offers no trade', () => {
    const html = render({ format: fmt({ kind: 'guillotine', elimination: true }), managers: { available: true, data: [mgr('2', { eliminated: { week: 3 } }), mgr('3')] } })
    expect(html).toContain('OUT · WEEK 3')
    expect(html.match(/Build a trade/g)?.length).toBe(1)
  })

  it('best ball: says there is no lineup to set', () => {
    expect(render({ format: fmt({ kind: 'best_ball', bestBall: true }), managers: { available: true, data: [mgr('2')] } })).toContain('there is no lineup to set')
  })

  it('dynasty: a picks line per team, and the reader’s caveat when partial', () => {
    const html = render({
      format: fmt({ kind: 'dynasty', dynasty: true, picks: { state: 'partial', note: 'Only picks that changed hands are modeled.' } }),
      managers: { available: true, data: [mgr('2', { picks: { count: 3, early: 2 } }), mgr('3', { picks: { count: 0, early: 0 } })] },
    })
    expect(html).toContain('3 future picks · 2 in rounds 1–2')
    expect(html).toContain('No future picks held')
    expect(html).toContain('Dynasty picks: Only picks that changed hands are modeled.')
  })

  it('redraft: no format note, and the opponent banner as before (the control)', () => {
    const html = render({ format: fmt({}), opponent: { managerId: '2', teamName: 'Team 2', headToHead: null }, managers: { available: true, data: [mgr('2', { isNextOpponent: true })] } })
    expect(html).not.toContain('af-sc-format')
    expect(html).toContain('You have not played them yet this season.')
  })
})
