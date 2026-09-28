import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import Trades from '@/components/core-app/screens/Trades'
import type { TradeAgentIdea, TradesData } from '@/lib/core-app/trades'

/*
 * The nightly trade agent's ideas on the Trades screen (design step 9). The section is ABSENT until
 * the agent's table exists, so a deploy ahead of the migration shows nothing new at all.
 */

function data(over: Partial<TradesData> = {}): TradesData {
  return {
    league: { id: 'l1', name: 'Last League Left', platform: 'sleeper', sourceLink: null },
    gradingContext: { available: false, reason: 'no grading context' },
    history: { available: false, reason: 'no trades' },
    inbox: { available: false, reason: 'not ingested' },
    sent: { available: false, reason: 'not ingested' },
    grades: { available: false, reason: 'nothing priced' },
    deadline: { available: false, reason: 'no deadline on file' },
    ...over,
  }
}

const idea: TradeAgentIdea = {
  id: 's1',
  partnerName: 'Gridiron Vultures',
  give: [{ name: 'Drake London', position: 'WR' }],
  get: [{ name: 'Kenneth Walker', position: 'RB' }],
  letter: 'C',
  partnerLetter: 'C',
  percentDiff: 4,
  viewerFitPct: 7,
  partnerFitPct: 3,
  basis: 'Dynasty chart',
  runDate: '2026-09-28',
}

describe('trades screen — nightly trade ideas', () => {
  it('shows nothing about ideas before the agent’s table exists', () => {
    const { container } = render(<Trades data={data()} />)
    expect(container.textContent).not.toContain('Trade ideas')
  })

  it('names the deal, the partner, both letters and what each roster gains — and that nothing is sent', () => {
    render(<Trades data={data({ agentIdeas: { available: true, data: [idea] } })} />)
    const section = screen.getByLabelText('Trade ideas')
    expect(section.textContent).toContain('Give Drake London (WR) for Kenneth Walker (RB) with Gridiron Vultures')
    expect(section.textContent).toContain('C/C')
    expect(section.textContent).toContain('your roster +7%')
    expect(section.textContent).toContain('theirs +3%')
    expect(section.textContent).toContain('nothing is sent')
  })

  it('a night with no ideas says so, rather than hiding the section', () => {
    render(<Trades data={data({ agentIdeas: { available: false, reason: 'No trade last night was near-even and good for both rosters.' } })} />)
    expect(screen.getByLabelText('Trade ideas').textContent).toContain('No trade last night was near-even')
  })
})
