import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/core-app/highlights/PlayerRecentClips', () => ({ default: () => null }))
vi.mock('@/components/core-app/player-card/PlayerHighlights', () => ({ default: () => null }))
vi.mock('@/components/core-app/player-card/PlayerValueHistoryChart', () => ({ PlayerValueHistoryChart: () => null }))

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import { playerCardActions } from '@/lib/core-app/playerCardActions'
import { playerCardRankChips, playerCardTabs } from '@/lib/core-app/playerCardTabs'
import { shapeDepthChart, shapeGameLog, type PlayerCardMore } from '@/lib/core-app/playerCardMore'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

/*
 * The league player card's roster actions and its Drop confirm (2026-11-26).
 *
 * Drop / Add hand off to the league's Players & waivers screen, which runs the existing add/drop and
 * claim routes with their rules; the card only decides what to OFFER. So this file pins the offer
 * rules (yours → Drop, free agent → Add, someone else's → Propose trade, imported or unreadable → no
 * roster move) and that the confirm sheet sends the manager to the hand-off, never to a write.
 */

const NO = (reason: string) => ({ available: false as const, reason })
type League = NonNullable<PlayerCardData['league']>

function league(over: Partial<League> = {}): League {
  return {
    leagueId: 'lg-1',
    leagueName: 'The Ciege NBA Redraft',
    platform: 'allfantasy',
    slot: 'BENCH',
    isYours: true,
    rosterPlayerId: 'nba-77',
    owner: { teamName: 'Ciege', ownerName: 'TheCiege24' },
    price: NO('not priced'),
    yourRoster: [],
    trades: [],
    playoffSchedule: NO('none'),
    watched: false,
    tradeBlock: { supported: false, note: '', listed: false, byYou: false, teamName: null, since: null },
    ...over,
  }
}

function card(l: League | null, over: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    context: l ? 'league' : 'universal',
    player: { externalId: 'ri:77', sleeperId: 'nba-77', sport: 'NBA', name: 'Darius Garland', position: 'PG', team: 'LAC', number: 10, imageUrl: null },
    bio: { age: 26, height: '6\'1"', weight: '192', yearsExp: 7, college: 'Vanderbilt' },
    market: NO('Market prices are published for NFL players only.'),
    ownership: NO('too few'),
    schedule: NO("Weekly schedules and byes are football's. This card does not list his games yet."),
    byeWeek: null,
    trades: NO('none'),
    comps: NO('none'),
    news: NO('none'),
    injury: NO('No current injury designation on any injury report.'),
    injuryFeed: NO('none'),
    insight: null,
    league: l,
    ...over,
  } as PlayerCardData
}

const subject = { name: 'Darius Garland', sleeperId: 'nba-77', externalId: 'ri:77' }

describe('playerCardActions — what the card offers', () => {
  it('offers Drop on your own player in a native league, handing off to Players & waivers', () => {
    const a = playerCardActions(league(), subject)
    expect(a.drop?.href).toBe('/league/lg-1?view=waivers&drop=nba-77')
    expect(a.add).toBeNull()
    expect(a.trade).toBeNull()
  })

  it('names the id his roster row carries, not the card id, when they differ', () => {
    const a = playerCardActions(league({ rosterPlayerId: 'roster-id-9' }), subject)
    expect(a.drop?.href).toContain('drop=roster-id-9')
  })

  it('offers Add on a free agent, with his name for the search box', () => {
    const a = playerCardActions(league({ slot: 'NOT ROSTERED', isYours: false, rosterPlayerId: undefined, owner: null }), subject)
    expect(a.drop).toBeNull()
    expect(a.add?.href).toBe('/league/lg-1?view=waivers&add=nba-77&q=Darius+Garland')
  })

  it("offers Propose trade on someone else's player", () => {
    const a = playerCardActions(league({ isYours: false }), subject)
    expect(a.trade?.href).toBe('/league/lg-1?view=trades')
    expect(a.drop).toBeNull()
    expect(a.add).toBeNull()
  })

  it('offers no roster move in an imported league — AllFantasy cannot make it on the platform', () => {
    expect(playerCardActions(league({ platform: 'sleeper' }), subject).drop).toBeNull()
    expect(playerCardActions(league({ platform: 'espn', slot: 'NOT ROSTERED', isYours: false }), subject).add).toBeNull()
    // A trade still goes to the builder, which hands off to the platform to send it.
    expect(playerCardActions(league({ platform: 'sleeper', isYours: false }), subject).trade?.href).toBe('/core/trades?league=lg-1')
  })

  it('offers nothing when the roster cannot be read, and nothing on the universal card', () => {
    expect(playerCardActions(league({ slot: 'UNREADABLE', isYours: false }), subject)).toEqual({ drop: null, add: null, trade: null })
    expect(playerCardActions(null, subject)).toEqual({ drop: null, add: null, trade: null })
  })
})

describe('playerCardTabs — a tab with nothing is hidden, never empty', () => {
  it('drops every tab a sport has no data for', () => {
    expect(playerCardTabs(card(league()), { gameLog: [], career: [], depthChart: null })).toEqual([])
  })

  it('shows the tabs that have rows, in order, with News last', () => {
    const more: PlayerCardMore = {
      gameLog: [{ season: 2026, week: 1, date: '2026-11-20', opponent: 'NOP', points: 30.5 }],
      career: [{ season: '2025', team: 'CLE', games: 70, points: 2100, perGame: 30 }],
      depthChart: null,
    }
    const data = card(league({ trades: [{ transactionId: 't', platform: 'allfantasy', leagueName: null, tradeDate: null, acquired: [], sent: [], picks: [] }] }), {
      news: { available: true, data: [{ title: 'Garland scores 27', source: 'espn', url: null, publishedAt: null }] },
    })
    expect(playerCardTabs(data, more)).toEqual(['gamelog', 'career', 'history', 'news'])
  })

  it('says each rank once: the league rank, not the market rank too', () => {
    const data = card(league(), {
      afLeagueProjection: { rank: 95, positionRank: 32, perGame: 18.8, weekly: null, fullSeason: null, restOfSeason: null, tradeValue: null } as never,
      market: { available: true, data: { overallRank: 12, positionRank: 4 } as never },
    })
    expect(playerCardRankChips(data, { overall: 'overall', rostered: 'rostered', started: 'started' })).toEqual([
      { value: '#32', label: 'PG' },
      { value: '#95', label: 'overall' },
    ])
  })
})

describe('playerCardMore shaping', () => {
  it('keeps only the newest season in the game log, newest game first, one row per game', () => {
    const rows = shapeGameLog([
      { season: 2025, weekOrRound: 3, gameDate: new Date('2025-11-01'), opponent: 'BOS', fantasyPoints: 10 },
      { season: 2026, weekOrRound: 1, gameDate: new Date('2026-11-20'), opponent: 'NOP', fantasyPoints: 30.55 },
      { season: 2026, weekOrRound: 1, gameDate: new Date('2026-11-20'), opponent: 'NOP', fantasyPoints: 29 },
      { season: 2026, weekOrRound: 2, gameDate: new Date('2026-11-22'), opponent: 'GSW', fantasyPoints: 41 },
    ])
    expect(rows.map((r) => [r.date, r.opponent, r.points])).toEqual([
      ['2026-11-22', 'GSW', 41],
      ['2026-11-20', 'NOP', 30.6],
    ])
  })

  it('marks the subject on his depth chart by id or by name', () => {
    const rows = shapeDepthChart(
      [
        { id: '2', player: 'Backup Guy', rank: 2 },
        { id: '1', player: 'Josh Allen', rank: 1 },
      ],
      { name: 'Josh Allen', ids: [] },
    )
    expect(rows).toEqual([
      { name: 'Josh Allen', rank: 1, isSubject: true },
      { name: 'Backup Guy', rank: 2, isSubject: false },
    ])
  })
})

describe('the card itself', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ gameLog: [], career: [], depthChart: null }) })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mount(data: PlayerCardData) {
    return render(
      <PlayerCardSheet subject={{ sport: 'NBA', sleeperId: 'nba-77', name: 'Darius Garland', position: 'PG' }} data={data} status="ready" onClose={() => {}} onOpen={() => {}} />,
    )
  }

  it('prints none of the old jargon', () => {
    const { container } = mount(card(league({ slot: 'UNREADABLE', isYours: false, owner: null })))
    const text = container.textContent ?? ''
    for (const phrase of ['UNREADABLE', "can't be matched", 'Market prices are published', "Weekly schedules and byes are football's", 'feed checked', 'No current injury designation']) {
      expect(text).not.toContain(phrase)
    }
  })

  it('Drop opens the confirm sheet; Cancel closes it; Confirm goes to the Players & waivers hand-off', async () => {
    mount(card(league()))
    expect(screen.queryByTestId('player-card-drop-confirm')).toBeNull()
    fireEvent.click(screen.getByTestId('player-card-drop'))
    const sheet = await screen.findByTestId('player-card-drop-confirm')
    expect(sheet.textContent).toContain('Confirm transaction')
    expect(sheet.textContent).toContain('Darius Garland')
    expect(screen.getByTestId('player-card-drop-go').getAttribute('href')).toBe('/league/lg-1?view=waivers&drop=nba-77')

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[1]!)
    await waitFor(() => expect(screen.queryByTestId('player-card-drop-confirm')).toBeNull())

    // No roster write happened at any point: the only request is the card's own read.
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls.every(([url]) => String(url).startsWith('/api/core/player-card/more'))).toBe(true)
  })

  it('shows Add on a free agent and Propose trade on another manager\'s player — never Drop', () => {
    const fa = mount(card(league({ slot: 'NOT ROSTERED', isYours: false, rosterPlayerId: undefined, owner: null })))
    expect(fa.queryByTestId('player-card-drop')).toBeNull()
    expect(fa.getByTestId('player-card-add').getAttribute('href')).toContain('view=waivers&add=nba-77')
    fa.unmount()

    const theirs = mount(card(league({ isYours: false })))
    expect(theirs.queryByTestId('player-card-drop')).toBeNull()
    expect(theirs.queryByTestId('player-card-add')).toBeNull()
    expect(theirs.getByTestId('player-card-trade')).toBeTruthy()
  })
})
