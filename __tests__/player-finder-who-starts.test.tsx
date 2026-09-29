/**
 * "Who'd start him": the ranking rule (fillLineup with and without him), the loader's guards, and the card.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Roster = { platformUserId: string; playerData: { players: string[] } }

const h = vi.hoisted(() => ({
  rows: new Map<string, { teams: Array<{ platformUserId: string; externalId: string | null; claimedByUserId: string | null; teamName: string }>; rosters: Roster[] }>(),
  info: new Map<string, { sleeperId: string; name: string; position: string; age: number | null }>(),
  values: new Map<string, number>(),
  settings: { roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'] } as unknown,
  readRows: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: vi.fn(async () => ({ settings: h.settings })) } } }))
vi.mock('@/lib/core-app/playerDepth', () => ({
  loadLeagueValueMap: vi.fn(async (ids: string[], leagueIds: string[]) =>
    new Map(leagueIds.map((l) => [l, new Map(ids.filter((id) => h.values.has(id)).map((id) => [id, { value: h.values.get(id)! }]))])),
  ),
}))
vi.mock('@/lib/core-app/playerTradeVisual', () => ({
  readLeagueTradeRows: h.readRows,
  callerTradeSeat: (rows: { teams: Array<{ claimedByUserId: string | null; platformUserId: string }>; rosters: Roster[] }, userId: string) => {
    const yours = rows.teams.find((t) => t.claimedByUserId === userId) ?? null
    return { yours, myRoster: yours ? rows.rosters.find((r) => r.platformUserId === yours.platformUserId) ?? null : null }
  },
  teamForTradeRoster: (teams: Array<{ platformUserId: string }>, r: Roster) => teams.find((t) => t.platformUserId === r.platformUserId) ?? null,
  tradeRosterPlayerIds: (r: Roster) => r.playerData.players,
  readTradePlayerRows: vi.fn(async (ids: string[]) => new Map(ids.filter((id) => h.info.has(id)).map((id) => [id, h.info.get(id)!]))),
  rosterSlotsOf: (s: { roster_positions?: string[] } | null) => (Array.isArray(s?.roster_positions) ? s!.roster_positions : null),
}))

import { PRICED_SHARE_MIN, SELL_LEAGUE_CAP, pricedShare, rankWhoStartsHim, slotName, type SellRoster } from '@/lib/core-app/whoStartsHim'
import { loadWhoStartsHim } from '@/lib/core-app/whoStartsHimLoader'
import { WhoStartsHim } from '@/components/core-app/player-finder/WhoStartsHim'

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN']
const P = (id: string, position: string, value: number | null, name = `P${id}`) => ({ id, name, position, value })
/** A full roster: QB, 3 RB, 3 WR, TE at the given RB values. */
const roster = (key: string, rb: [number | null, number | null, number | null], wr = 50): SellRoster => ({
  key,
  teamName: `Team ${key}`,
  players: [
    P(`${key}qb`, 'QB', 60),
    P(`${key}rb1`, 'RB', rb[0], `${key} RB1`),
    P(`${key}rb2`, 'RB', rb[1], `${key} RB2`),
    P(`${key}rb3`, 'RB', rb[2], `${key} RB3`),
    P(`${key}wr1`, 'WR', wr),
    P(`${key}wr2`, 'WR', wr),
    P(`${key}wr3`, 'WR', wr - 5),
    P(`${key}te`, 'TE', 30),
  ],
})
const HIM = { id: 'him', position: 'RB', value: 40 }

describe('rankWhoStartsHim (pure)', () => {
  it('he starts for a team whose starter he beats, over that starter, best gain first', () => {
    const { teams } = rankWhoStartsHim({
      him: HIM,
      // Given worst-first, so the order below is the ranking's doing, not the input's.
      others: [roster('C', [90, 85, 60], 50), roster('B', [80, 30, 10], 50), roster('A', [80, 70, 20], 30)],
      slots: SLOTS,
    })
    // A: FLEX holds WR3 at 25 → he (40) takes it, +15. B: RB2 is 30 → he takes RB, +10.
    // C: FLEX holds RB3 at 60 → he beats nobody, so C is not listed.
    expect(teams.map((t) => [t.teamName, t.slot, t.bumps?.name ?? null])).toEqual([
      ['Team A', 'FLEX', 'PAwr3'],
      ['Team B', 'RB', 'B RB2'],
    ])
    expect(teams.map((t) => t.gain)).toEqual([15, 10])
  })

  it('a tie is not a start — he has to add something to be listed', () => {
    // RB2 is exactly his value, and FLEX (WR3 45) is above it: any lineup with him in it scores the same.
    for (const order of [[roster('E', [80, 40, 10], 50)], [roster('E', [80, 40, 10], 50)].map((r) => ({ ...r, players: [...r.players].reverse() }))]) {
      expect(rankWhoStartsHim({ him: HIM, others: order, slots: SLOTS }).teams).toEqual([])
    }
  })

  it('an unpriced player is not a starter to beat — he fills that slot with nobody bumped', () => {
    const { teams } = rankWhoStartsHim({ him: HIM, others: [roster('U', [80, null, null], 50)], slots: SLOTS })
    expect(teams).toHaveLength(1)
    expect(teams[0]).toMatchObject({ slot: 'RB', bumps: null })
  })

  it('a stale copy of him on their roster is not a second him', () => {
    const r = roster('D', [80, 30, 10])
    r.players.push(P('him', 'RB', 40))
    const { teams } = rankWhoStartsHim({ him: HIM, others: [r], slots: SLOTS })
    expect(teams[0]).toMatchObject({ slot: 'RB', bumps: { name: 'D RB2' } })
  })

  it('reports a lineup slot the engine does not model', () => {
    expect(rankWhoStartsHim({ him: HIM, others: [roster('A', [80, 30, 10])], slots: [...SLOTS, 'MYSTERY'] }).unknownSlots).toEqual(['MYSTERY'])
  })

  it('priced share counts skill positions only', () => {
    const r: SellRoster = { key: 'k', teamName: 'K', players: [P('1', 'RB', 10), P('2', 'WR', null), P('3', 'K', null), P('4', 'DEF', null)] }
    expect(pricedShare([r])).toBe(0.5)
    expect(pricedShare([])).toBe(0)
  })

  it('names Sleeper slots the way managers say them', () => {
    expect(slotName('SUPER_FLEX')).toBe('superflex')
    expect(slotName('REC_FLEX')).toBe('WR/TE flex')
    expect(slotName('rb')).toBe('RB')
  })
})

// ── Loader ────────────────────────────────────────────────────────────────────────────────────────
const team = (id: string, name: string, claimed: string | null = null) => ({ platformUserId: id, externalId: null, claimedByUserId: claimed, teamName: name })
function seedLeague(leagueId: string) {
  const mine: Roster = { platformUserId: 'me', playerData: { players: ['him'] } }
  const others: Roster[] = ['x', 'y'].map((k) => ({ platformUserId: k, playerData: { players: [`${k}qb`, `${k}rb1`, `${k}rb2`, `${k}wr1`, `${k}wr2`, `${k}wr3`, `${k}te`] } }))
  h.rows.set(leagueId, { teams: [team('me', 'My Team', 'u1'), team('x', 'Xavier FC'), team('y', 'Yonder')], rosters: [mine, ...others] })
}
beforeEach(() => {
  vi.clearAllMocks()
  h.rows = new Map()
  h.info = new Map()
  h.values = new Map([['him', 40]])
  h.settings = { roster_positions: SLOTS }
  for (const k of ['x', 'y']) {
    const pos: Record<string, string> = { qb: 'QB', rb1: 'RB', rb2: 'RB', wr1: 'WR', wr2: 'WR', wr3: 'WR', te: 'TE' }
    for (const [suffix, position] of Object.entries(pos)) {
      h.info.set(`${k}${suffix}`, { sleeperId: `${k}${suffix}`, name: `${k.toUpperCase()} ${suffix.toUpperCase()}`, position, age: 25 })
      h.values.set(`${k}${suffix}`, suffix === 'rb2' ? (k === 'x' ? 20 : 70) : 60)
    }
  }
  h.info.set('him', { sleeperId: 'him', name: 'Him', position: 'RB', age: 24 })
  seedLeague('L1')
  h.readRows.mockImplementation(async (id: string) => h.rows.get(id) ?? { teams: [], rosters: [] })
})
const load = (over: Partial<Parameters<typeof loadWhoStartsHim>[0]> = {}) =>
  loadWhoStartsHim({ userId: 'u1', sleeperId: 'him', position: 'RB', yourLeagues: [{ leagueId: 'L1', leagueName: 'KBFL', platform: 'sleeper' }], include: true, ...over })

describe('loadWhoStartsHim', () => {
  it('ranks the other teams in a league where he is yours', async () => {
    const v = await load()
    expect(v!.locked).toBe(false)
    expect(v!.leagues[0]).toMatchObject({ state: 'ranked', otherTeams: 2 })
    expect(v!.leagues[0].teams.map((t) => [t.teamName, t.slot, t.bumps?.name])).toEqual([['Xavier FC', 'RB', 'X RB2']])
  })

  it('locked: nothing is read, and the lock is what comes back', async () => {
    expect(await load({ include: false })).toEqual({ leagues: [], locked: true })
    expect(h.readRows).not.toHaveBeenCalled()
  })

  it('no card for a non-skill player or a player who is yours nowhere', async () => {
    expect(await load({ position: 'K' })).toBeNull()
    expect(await load({ yourLeagues: [] })).toBeNull()
    expect(await load({ sleeperId: null })).toBeNull()
  })

  it('an ESPN or other foreign-id league is named unread and never scanned', async () => {
    const v = await load({ yourLeagues: [{ leagueId: 'E1', leagueName: 'ESPN League', platform: 'espn' }, { leagueId: 'F1', leagueName: 'Flea', platform: 'fleaflicker' }] })
    expect(v!.leagues.map((l) => l.state)).toEqual(['unread', 'unread'])
    expect(h.readRows).not.toHaveBeenCalled()
  })

  it('a league where your team cannot be found is unread', async () => {
    h.rows.get('L1')!.teams[0].claimedByUserId = null
    expect((await load()).leagues[0]).toMatchObject({ state: 'unread', teams: [] })
  })

  it('no lineup on file, or him unpriced: unmeasured, not ranked', async () => {
    h.settings = {}
    expect((await load()).leagues[0]).toMatchObject({ state: 'unmeasured', note: expect.stringMatching(/lineup/) })
    h.settings = { roster_positions: SLOTS }
    h.values.delete('him')
    expect((await load()).leagues[0]).toMatchObject({ state: 'unmeasured', note: expect.stringMatching(/no market value/) })
  })

  it(`a league whose rosters are under ${PRICED_SHARE_MIN * 100}% priced is not ranked — a half-read roster starts anyone`, async () => {
    for (const k of ['x', 'y']) for (const s of ['wr1', 'wr2', 'te']) h.values.delete(`${k}${s}`)
    expect((await load()).leagues[0]).toMatchObject({ state: 'unmeasured', note: expect.stringMatching(/too few players/) })
  })

  it(`reads at most ${SELL_LEAGUE_CAP} leagues`, async () => {
    const many = Array.from({ length: SELL_LEAGUE_CAP + 2 }, (_, i) => ({ leagueId: `L${i}`, leagueName: `League ${i}`, platform: 'sleeper' }))
    for (const l of many) seedLeague(l.leagueId)
    const v = await load({ yourLeagues: many })
    expect(v!.leagues).toHaveLength(SELL_LEAGUE_CAP)
    expect(h.readRows).toHaveBeenCalledTimes(SELL_LEAGUE_CAP)
  })
})

describe('WhoStartsHim card', () => {
  const access = { depth: 'player_depth', unlocked: false, label: 'Player depth', planName: 'AF Pro', preLaunchFree: false, startsAt: '2026-10-15T00:00:00.000Z' } as never

  it('names the teams, the slot and whom he bumps, with the Trade Center one tap away', async () => {
    const v = await load()
    render(<WhoStartsHim data={v} playerName="James Cook" access={null} />)
    expect(screen.getByRole('heading', { name: "Who'd start Cook" })).toBeTruthy()
    expect(screen.getByText('would start for 1 of 2 teams')).toBeTruthy()
    expect(screen.getByText('Xavier FC').parentElement!.textContent).toContain('at RB, over X RB2')
    expect(screen.getByRole('link', { name: 'Open Trade Center' }).getAttribute('href')).toBe('/core/trades?league=L1')
  })

  it('says so when nobody would start him', async () => {
    h.values.set('xrb2', 70)
    render(<WhoStartsHim data={await load()} playerName="James Cook" access={null} />)
    expect(screen.getByText('no team would start him over what they have')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open Trade Center' })).toBeNull()
  })

  it('locked: the AF Pro lock and no teams', () => {
    render(<WhoStartsHim data={{ leagues: [], locked: true }} playerName="James Cook" access={access} />)
    expect(screen.getByTestId('core-lock-player_depth')).toBeTruthy()
    expect(screen.queryByText(/would start for/)).toBeNull()
  })
})
