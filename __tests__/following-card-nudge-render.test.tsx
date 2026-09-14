import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { FollowingCard } from '@/components/core-app/screens/FollowingCard'
import type { FollowingCardData, FollowingRow } from '@/lib/core-app/followingCard'

/*
 * The waiver nudge as rendered (2026-09-14): a followed player on no roster in one of your
 * leagues links straight to that league's waiver screen.
 */

const row = (over: Partial<FollowingRow> = {}): FollowingRow => ({
  sport: 'NFL',
  playerKey: '9221',
  sleeperId: '9221',
  externalId: null,
  name: 'Jahmyr Gibbs',
  position: 'RB',
  team: 'DET',
  status: null,
  next: null,
  freeAgentIn: [],
  ...over,
})

const data = (rows: FollowingRow[]): FollowingCardData => ({ rows, total: rows.length, statusCoverage: 'ok' })

describe('FollowingCard — waiver nudge', () => {
  it('🛑 one league: names it and links to its waivers', () => {
    render(
      <FollowingCard
        data={data([row({ freeAgentIn: [{ leagueId: 'lg-ice', leagueName: 'Ice Kings', href: '/core/waivers?league=lg-ice' }] })])}
      />,
    )
    const link = screen.getByRole('link', { name: 'Free agent in Ice Kings →' })
    expect(link.getAttribute('href')).toBe('/core/waivers?league=lg-ice')
  })

  it('several leagues: counts them and links to the first', () => {
    render(
      <FollowingCard
        data={data([
          row({
            freeAgentIn: [
              { leagueId: 'lg-a', leagueName: 'A', href: '/core/waivers?league=lg-a' },
              { leagueId: 'lg-b', leagueName: 'B', href: '/core/waivers?league=lg-b' },
            ],
          }),
        ])}
      />,
    )
    const link = screen.getByRole('link', { name: 'Free agent in 2 of your leagues →' })
    expect(link.getAttribute('href')).toBe('/core/waivers?league=lg-a')
  })

  it('🛑 rostered everywhere (or unknown): no nudge at all', () => {
    render(<FollowingCard data={data([row()])} />)
    expect(screen.queryByRole('link', { name: /Free agent/ })).toBeNull()
  })
})
