import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

/**
 * Item #8 on the Trade Center: the ranking orders the "Trading with" chips and can start a deal.
 */

const rosterData = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/components/core-app/screens/useLeagueRosters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/core-app/screens/useLeagueRosters')>()
  return { ...actual, useLeagueRosters: () => ({ data: rosterData.current, state: 'idle' }) }
})

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

const LEAGUE = { id: 'l1', name: 'Draft Junkies', format: 'Dynasty · PPR', teamCount: 12 }

const player = (id: string, name: string, position: string, value: number) => ({
  id, name, position, team: 'KC', imageUrl: null, byeWeek: null, injuryStatus: null, value, stock: null, stockDelta: null,
})
const roster = (rosterId: string, ownerName: string, players: unknown[]) => ({
  rosterId, platformUserId: `u-${rosterId}`, players, picks: [], teamExternalId: `t-${rosterId}`,
  ownerName, avatarUrl: null, wins: 0, losses: 0, ties: 0, faabRemaining: null, canReceiveProposal: false,
})

const RANKING = {
  gaps: ['Trade history is not on file for this league, so past dealing did not count.'],
  partners: [
    {
      rosterId: 'r3', ownerName: 'Charlie', rank: 1, score: 71, label: 'Strong fit',
      components: { availability: 0.9, need: 0.5, package: 0.8, history: null },
      reasons: ['Has a spare RB: Runner (4,600) would start over your weakest RB (800).'],
      suggestion: {
        give: [{ id: 'p1', name: 'Receiver', position: 'WR', value: 4000, kind: 'player' }],
        get: [{ id: 'p30', name: 'Runner', position: 'RB', value: 4600, kind: 'player' }],
        percentApart: 13,
      },
    },
    {
      rosterId: 'r2', ownerName: 'Bravo', rank: 2, score: 12, label: 'Weak fit',
      components: { availability: 0, need: 0, package: 0, history: null }, reasons: [], suggestion: null,
    },
  ],
}

beforeEach(() => {
  rosterData.current = {
    rosters: [
      roster('r1', 'You', [player('p1', 'Receiver', 'WR', 4000)]),
      roster('r2', 'Bravo', [player('p20', 'Somebody', 'TE', 1000)]),
      roster('r3', 'Charlie', [player('p30', 'Runner', 'RB', 4600)]),
      roster('r4', 'Delta', []),
    ],
    viewerRosterId: 'r1',
    viewerTeamRosterId: 'r1',
    partnerRanking: RANKING,
  }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
})

const chips = () => [...document.querySelectorAll('.af-tc-partner-chip')].map((c) => c.textContent)

describe('Trade Center partner ranking', () => {
  it('orders the chips by rank, keeping unranked teams after, in roster order', () => {
    render(<TradeCenter league={LEAGUE} />)
    expect(chips()).toEqual(['Charlie', 'Bravo', 'Delta'])
  })

  it('keeps roster order when no ranking arrived', () => {
    ;(rosterData.current as { partnerRanking: unknown }).partnerRanking = undefined
    render(<TradeCenter league={LEAGUE} />)
    expect(chips()).toEqual(['Bravo', 'Charlie', 'Delta'])
    expect(document.querySelector('.af-tc-fits')).toBeNull()
  })

  it('renders the suggestions inside the "You get" step block, with the gaps', () => {
    render(<TradeCenter league={LEAGUE} />)
    const fits = document.querySelector('.af-tc-fits')!
    expect(fits.closest('[data-mstep]')?.getAttribute('data-mstep')).toBe('get')
    expect(fits.textContent).toContain('Charlie')
    expect(fits.textContent).toContain('Trade history is not on file')
  })

  it('choosing a partner from a card selects the same team as its chip', () => {
    render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getAllByText('Trade with them')[0]!)
    const on = [...document.querySelectorAll('.af-tc-partner-chip')].find((c) => c.getAttribute('data-on') === 'true')
    expect(on?.textContent).toBe('Charlie')
  })

  it('🛑 "Start with this deal" loads BOTH sides from the right rosters, sets the partner, and opens Review', () => {
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByText('Start with this deal'))

    // Deal rows only (`div.af-tc-row[data-kind]`): the roster list below uses the same name class.
    const names = (side: string) =>
      [...container.querySelectorAll(`.af-tc-team[data-mstep='${side}'] div.af-tc-row[data-kind] .af-tc-row-name`)].map((n) => n.textContent)
    expect(names('give')).toEqual(['Receiver'])
    expect(names('get')).toEqual(['Runner'])
    expect(container.querySelector('.af-tc')?.getAttribute('data-mobile-step')).toBe('review')
    const on = [...document.querySelectorAll('.af-tc-partner-chip')].find((c) => c.getAttribute('data-on') === 'true')
    expect(on?.textContent).toBe('Charlie')
    expect(document.body.textContent).toContain('Started from a suggested deal with Charlie')
  })
})
