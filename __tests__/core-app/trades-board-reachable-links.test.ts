/**
 * 🛑 The cross-league Trades board linked another importer's copy of a league (field test,
 * 2026-09-25): KBFL, Bla bla bla and Guillotine League 26 ($30) opened `b5190928…` instead of the
 * reader's `1add89f9…`, and /core — which gates `?league=` on the reader's own list — bounced them
 * straight back. `pointBoardAtReachableLeagues` points each card at the reader's copy of the SAME
 * real league (platform + provider id + season), and touches nothing it cannot match.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pointBoardAtReachableLeagues, type TradesBoardData } from '@/lib/core-app/tradesBoard'
import { realLeagueKey } from '@/lib/core-app/realLeague'

const key = (platformLeagueId: string, season = 2026, leagueId = 'x') =>
  realLeagueKey({ platform: 'sleeper', platformLeagueId, season, leagueId })

function windowRow(leagueId: string, realKey: string | undefined) {
  return {
    leagueId,
    leagueName: 'KBFL',
    platform: 'sleeper',
    logoUrl: null,
    deadlineWeek: 11,
    noDeadline: false,
    weeksLeft: 8,
    regularSeasonLength: 14,
    tradesOnFile: 3,
    latest: null,
    href: `/core/trades?league=${leagueId}`,
    reasoning: '',
    realKey,
  }
}

function board(windows: ReturnType<typeof windowRow>[], pendingLeague?: { leagueId: string; realKey?: string }): TradesBoardData {
  return {
    pending: pendingLeague
      ? [{ id: 'p1', leagueId: pendingLeague.leagueId, realKey: pendingLeague.realKey, leagueName: 'KBFL', platform: 'sleeper', logoUrl: null, status: 'pending', expiresAt: null, youProposed: false, items: [] }]
      : [],
    windows,
  } as unknown as TradesBoardData
}

describe('pointBoardAtReachableLeagues', () => {
  const reachable = [{ id: 'mine-1add89f9', platform: 'sleeper', platformLeagueId: 'SL-KBFL', season: 2026 }]

  it('points a card built on another importer’s copy at the reader’s own copy', () => {
    const out = pointBoardAtReachableLeagues(board([windowRow('theirs-b5190928', key('SL-KBFL'))]), reachable)
    expect(out.windows[0]!.leagueId).toBe('mine-1add89f9')
    expect(out.windows[0]!.href).toBe('/core/trades?league=mine-1add89f9')
  })

  it('does the same for a pending trade’s "Review it" link', () => {
    const out = pointBoardAtReachableLeagues(board([], { leagueId: 'theirs-b5190928', realKey: key('SL-KBFL') }), reachable)
    expect(out.pending[0]!.leagueId).toBe('mine-1add89f9')
  })

  it('matches the SEASON too — last year’s copy is a different league', () => {
    const out = pointBoardAtReachableLeagues(board([windowRow('theirs-2025', key('SL-KBFL', 2025))]), reachable)
    expect(out.windows[0]!.leagueId).toBe('theirs-2025')
  })

  it('leaves a card alone when the reader holds no copy of that league, or it carries no key', () => {
    const out = pointBoardAtReachableLeagues(
      board([windowRow('other-league', key('SL-OTHER')), windowRow('cached-old', undefined)]),
      reachable,
    )
    expect(out.windows.map((w) => w.leagueId)).toEqual(['other-league', 'cached-old'])
    expect(out.windows[1]!.href).toBe('/core/trades?league=cached-old')
  })

  it('a card already on a reachable row is returned untouched', () => {
    const row = windowRow('mine-1add89f9', key('SL-KBFL'))
    const out = pointBoardAtReachableLeagues(board([row]), reachable)
    expect(out.windows[0]).toBe(row)
  })
})

describe('the /core page applies it to every board read', () => {
  it('both the live read and the cached summary go through the remap', () => {
    const page = readFileSync(join(process.cwd(), 'app/core/[[...screen]]/page.tsx'), 'utf8')
    expect(page).toMatch(/const tradesBoard = tradesBoardRead\s*\?\s*pointBoardAtReachableLeagues\(/)
    expect(page).toMatch(/const tradesBoardRead = wantsTradesBoard[\s\S]{0,200}tradesBoardFresh\?\.data[\s\S]{0,120}getTradesBoard\(/)
  })
})
