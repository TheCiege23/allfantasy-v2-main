import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'

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

/*
 * Trade depth (AF Pro, from Oct 15). The routes withhold the data from a locked viewer — the
 * rosters route sends no ranking, the analyze route no breakdown, the finder refuses — so these pin
 * what the SCREEN draws. The breakdown case deliberately hands the screen an analysis that still
 * carries `tradeIntelligence`: the lock must not depend on the data happening to be absent.
 */
describe('Trade Center — trade depth paywall', () => {
  const START = new Date('2026-10-15T04:00:00.000Z')
  const LOCKED = decideCoreDepth('trade_depth', { live: true, startsAt: START, hasPlan: false })
  const PRELAUNCH = decideCoreDepth('trade_depth', { live: false, startsAt: START, hasPlan: false })

  const ANALYSIS = {
    fairnessScore: 55,
    confidenceScore: 60,
    percentDiff: 4,
    labels: { fairnessLabel: 'Fair', confidenceLabel: 'Medium confidence' },
    players: { give: [{ name: 'Receiver', position: 'WR', team: 'KC', marketValue: 4000, pricedSource: 'fantasycalc' }], get: [] },
    tradeIntelligence: {
      why: 'You sell a starter for depth you do not need.',
      whoWinsNow: 'opponent',
      whoWinsLongTerm: 'you',
      contenderRecommendation: 'A contender should pass.',
      rebuilderRecommendation: 'A rebuilder should take it.',
      tradeWarnings: [],
      rebalanceSuggestions: [],
      alternateTargets: [],
    },
  }

  const analyze = async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/trade-value/analyze'
          ? { ok: true, status: 200, json: async () => ANALYSIS }
          : { ok: false, status: 500, json: async () => ({}) },
      ),
    )
    fireEvent.click(screen.getByLabelText('Add Receiver'))
    fireEvent.click(screen.getByText('Analyze this trade'))
    await waitFor(() => expect(document.body.textContent).toContain('Fair'))
  }

  it('locked: who to trade with and the finder are locks; the "Trading with" chips stay', () => {
    render(<TradeCenter league={LEAGUE} depthAccess={LOCKED} />)
    expect(document.querySelector('.af-tc-fits')).toBeNull()
    const who = screen.getByRole('region', { name: 'Who to trade with — AF Pro' })
    expect(within(who).getByRole('link', { name: 'See AF Pro' })).toHaveAttribute('href', '/upgrade?plan=pro')
    expect(screen.getByRole('region', { name: 'The trade finder — AF Pro' })).toBeInTheDocument()
    expect(screen.queryByText('Find trade partners')).toBeNull()
    expect(chips()).toEqual(['Charlie', 'Bravo', 'Delta'])
  })

  it('locked: the verdict renders and the breakdown under it is a lock, even if the data arrived', async () => {
    render(<TradeCenter league={LEAGUE} depthAccess={LOCKED} />)
    await analyze()
    expect(screen.getByRole('region', { name: 'The full trade breakdown — AF Pro' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Decision OS · this deal')
    expect(document.body.textContent).not.toContain('You sell a starter for depth you do not need.')
  })

  it('before launch the breakdown renders, marked "Free until Oct 15 — then AF Pro"', async () => {
    render(<TradeCenter league={LEAGUE} depthAccess={PRELAUNCH} />)
    expect(document.querySelector('.af-tc-fits')).not.toBeNull()
    await analyze()
    expect(document.body.textContent).toContain('Decision OS · this deal')
    expect(document.body.textContent).toContain('You sell a starter for depth you do not need.')
    expect(screen.getByTestId('core-free-until-trade_depth')).toHaveTextContent('Free until Oct 15 — then AF Pro')
    expect(screen.queryByTestId('core-lock-trade_depth')).toBeNull()
  })
})

/*
 * Competitive Edge in the Trade Center: the chosen partner's own trade record, bound to the deal.
 * Its own depth (AF Pro and the War Room plan). The route computes it only for a viewer who has it;
 * the lock here must hold even if an analysis somehow carried it.
 */
describe('Trade Center — Competitive Edge', () => {
  const START = new Date('2026-10-15T04:00:00.000Z')
  const EDGE_LOCKED = decideCoreDepth('competitive_edge', { live: true, startsAt: START, hasPlan: false })
  const EDGE_OPEN = decideCoreDepth('competitive_edge', { live: true, startsAt: START, hasPlan: true })
  const EDGE_PRELAUNCH = decideCoreDepth('competitive_edge', { live: false, startsAt: START, hasPlan: false })

  const EDGE = {
    available: true,
    data: {
      manager: { name: 'Charlie', teamExternalId: 't-r3' },
      coverage: {
        source: 'sleeper_trade_history',
        trades: 5,
        seasons: ['2024', '2025', '2026'],
        gaps: [],
        firstSeason: '2024',
        lastTradeAt: '2026-09-10T15:00:00.000Z',
        asOf: '2026-09-24T22:00:00.000Z',
        stale: false,
        sufficient: true,
        shortfall: null,
      },
      facts: [
        { key: 'trade.acquired.WR', text: 'Charlie took on a WR in 3 of their 5 trades (4 WRs in all).', bearsOnDeal: true },
        { key: 'trade.volume', text: 'Charlie has made 5 trades in this league since 2024; the last was Sep 10, 2026.', bearsOnDeal: false },
      ],
    },
  }

  const analyzeWith = async (edge: unknown) => {
    const analyzeCalls: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url !== '/api/trade-value/analyze') return { ok: false, status: 500, json: async () => ({}) }
        analyzeCalls.push(JSON.parse(String(init?.body ?? '{}')))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            fairnessScore: 55,
            confidenceScore: 60,
            percentDiff: 4,
            labels: { fairnessLabel: 'Fair', confidenceLabel: 'Medium confidence' },
            players: { give: [], get: [] },
            ...(edge ? { competitiveEdge: edge } : {}),
          }),
        }
      }),
    )
    const charlie = [...document.querySelectorAll('.af-tc-partner-chip')].find((c) => c.textContent === 'Charlie')!
    fireEvent.click(charlie)
    fireEvent.click(screen.getByLabelText('Add Receiver'))
    fireEvent.click(screen.getByText('Analyze this trade'))
    await waitFor(() => expect(document.body.textContent).toContain('Fair'))
    return analyzeCalls
  }

  it('open: the partner’s record for this deal, the deal lines first, with its basis', async () => {
    render(<TradeCenter league={LEAGUE} edgeAccess={EDGE_OPEN} />)
    const calls = await analyzeWith(EDGE)
    // The partner goes to the route — that is what binds the edge to this manager.
    expect(calls[0]!.opponentTeamExternalId).toBe('t-r3')
    const section = screen.getByTestId('trade-competitive-edge')
    expect(within(section).getByText('Competitive Edge · Charlie')).toBeInTheDocument()
    const lists = section.querySelectorAll('ul')
    expect(lists[0]!.textContent).toContain('took on a WR in 3 of their 5 trades')
    expect(lists[1]!.textContent).toContain('has made 5 trades in this league since 2024')
    expect(screen.getByTestId('trade-competitive-edge-basis').textContent).toMatch(
      /Counted from completed trades in this league's Sleeper history \(2024–2026\), as of .+ ET\. It shows what they did, not whether they will accept\./,
    )
    expect(screen.queryByTestId('core-free-until-competitive_edge')).toBeNull()
  })

  it('🛑 locked: a lock to AF Pro, and none of the record — even if the analysis carried it', async () => {
    render(<TradeCenter league={LEAGUE} edgeAccess={EDGE_LOCKED} />)
    await analyzeWith(EDGE)
    const lock = screen.getByRole('region', { name: 'Competitive Edge — AF Pro' })
    expect(within(lock).getByRole('link', { name: 'See AF Pro' })).toHaveAttribute('href', '/upgrade?plan=pro')
    expect(screen.queryByTestId('trade-competitive-edge')).toBeNull()
    expect(document.body.textContent).not.toContain('took on a WR')
  })

  it('a history that could not be read says why, instead of reading as a quiet trader', async () => {
    render(<TradeCenter league={LEAGUE} edgeAccess={EDGE_OPEN} />)
    await analyzeWith({ available: false, reason: "Competitive Edge reads Sleeper trade history today. ESPN leagues aren't connected yet." })
    expect(screen.getByTestId('trade-competitive-edge').textContent).toContain("ESPN leagues aren't connected yet.")
  })

  it('before launch it renders, marked "Free until Oct 15 — then AF Pro"', async () => {
    render(<TradeCenter league={LEAGUE} edgeAccess={EDGE_PRELAUNCH} />)
    await analyzeWith(EDGE)
    expect(screen.getByTestId('core-free-until-competitive_edge')).toHaveTextContent('Free until Oct 15 — then AF Pro')
  })

  it('no partner chosen → no section at all', async () => {
    render(<TradeCenter league={LEAGUE} edgeAccess={EDGE_OPEN} />)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fairnessScore: 50, labels: { fairnessLabel: 'Fair' }, players: { give: [], get: [] } }) })))
    fireEvent.click(screen.getByLabelText('Add Receiver'))
    fireEvent.click(screen.getByText('Analyze this trade'))
    await waitFor(() => expect(document.body.textContent).toContain('Fair'))
    expect(screen.queryByTestId('trade-competitive-edge')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Competitive Edge — AF Pro' })).toBeNull()
  })
})
