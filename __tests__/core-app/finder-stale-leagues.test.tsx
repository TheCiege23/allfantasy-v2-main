/**
 * Player Finder's "Lineups as of" (2026-11-09). It was dated by the single oldest league read, so one
 * league that stopped syncing made the whole Game day list read "as of 53d ago" over 47 fresh ones.
 * It now uses the same rule as War Room's Game Plan (splitRosterAges): stale leagues are named with
 * their age, and the stamp describes the rest.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { GameDayTriage } from '@/components/core-app/player-finder/GameDayTriage'
import { ROSTER_STALE_AFTER_MS, splitRosterAges } from '@/lib/core-app/gameDayTriage'

const NOW = '2026-10-02T17:00:00.000Z'
const STALE = { leagueId: 'S', leagueName: 'Stale League', asOf: '2026-08-10T12:00:00.000Z' }
const FRESH = { leagueId: 'F', leagueName: 'Fresh League', asOf: '2026-10-02T16:15:00.000Z' }

describe('splitRosterAges', () => {
  it('names a league past the threshold, oldest first, and dates the list by the rest', () => {
    const older = { leagueId: 'O', leagueName: 'Older', asOf: '2026-07-01T12:00:00.000Z' }
    const out = splitRosterAges({ rostersAsOf: older.asOf, rosterAges: [FRESH, STALE, older] }, NOW)
    expect(out.stale.map((a) => a.leagueId)).toEqual(['O', 'S'])
    expect(out.stale[1]!.days).toBe(53)
    expect(out.freshCount).toBe(1)
    expect(out.stampAsOf).toBe(FRESH.asOf)
  })

  it('keeps the oldest stamp when every league is stale, or when no ages are known', () => {
    expect(splitRosterAges({ rostersAsOf: STALE.asOf, rosterAges: [STALE] }, NOW).stampAsOf).toBe(STALE.asOf)
    expect(splitRosterAges({ rostersAsOf: STALE.asOf }, NOW)).toEqual({ stale: [], freshCount: 0, stampAsOf: STALE.asOf })
  })

  it('treats exactly the threshold as fresh', () => {
    const edge = { leagueId: 'E', leagueName: 'Edge', asOf: new Date(new Date(NOW).getTime() - ROSTER_STALE_AFTER_MS).toISOString() }
    expect(splitRosterAges({ rostersAsOf: edge.asOf, rosterAges: [edge] }, NOW).stale).toEqual([])
  })
})

describe('Player Finder Game day', () => {
  const render = (rosterAges: Array<typeof STALE>) =>
    renderToStaticMarkup(
      <GameDayTriage
        state={{
          available: true,
          data: { rows: [], week: { season: 2026, week: 4 }, leaguesRead: 2, startersRead: 18, rostersAsOf: STALE.asOf, rosterAges } as never,
        }}
        nowIso={NOW}
        leagueCount={2}
      />,
    )

  it('names the stale league with its age and a sync link, and dates the list by the fresh one', () => {
    const html = render([STALE, FRESH])
    expect(html).toContain('45 min ago')
    expect(html).not.toContain('53d ago · Refresh')
    expect(html).toContain('Not synced in over 3 days')
    expect(html).toContain('href="/core/sync?league=S"')
    expect(html).toContain('(53d ago)')
    expect(html).not.toContain('Fresh League</a>')
  })

  it('adds no note when every league is fresh', () => {
    const html = render([FRESH])
    expect(html).not.toContain('Not synced in over 3 days')
  })
})
