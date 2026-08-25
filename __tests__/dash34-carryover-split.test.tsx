import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { Dash34Carryover, Dash34Coverage } from '@/components/core-app/screens/Dash34Carryover'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'

/**
 * Two behaviours worth pinning, and they pull in opposite directions.
 *
 * The brief must render even when there is nothing to report — that is how a
 * reader tells "we checked and it is clear" from "we are not looking", and the
 * loader documents it as deliberate. The coverage disclosure must NOT be what
 * keeps the band alive, because it is a footnote and it was sitting third on
 * the page, setting the tone to apology before anything useful was shown.
 */

function data(over: Partial<Dash34Data> = {}): Dash34Data {
  return {
    firstLock: null,
    notice: null,
    chimmyBrief: null,
    coverage: [],
    ...over,
  } as unknown as Dash34Data
}

const BRIEF = {
  label: 'CHIMMY’S BRIEF',
  headline: 'Nothing is waiting on you',
  lines: [],
  caveat: 'Built from the injury feed and the fixture list.',
  moreHref: '/core',
  moreLabel: 'See every call',
} as unknown as Dash34Data['chimmyBrief']

describe('Dash34Carryover', () => {
  it('still renders in the quiet case, so silence is distinguishable from absence', () => {
    const { container } = render(<Dash34Carryover data={data({ chimmyBrief: BRIEF })} />)
    expect(container.textContent).toContain('Nothing is waiting on you')
  })

  it('coverage alone no longer keeps the band alive', () => {
    // Coverage moved to the foot. If it still counted toward this guard the
    // band would render an empty frame around a footnote that is not there.
    const { container } = render(
      <Dash34Carryover
        data={data({ coverage: [{ label: 'League chatter', reason: 'not ingested' }] as never })}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('does not render the coverage list itself any more', () => {
    const { container } = render(
      <Dash34Carryover
        data={data({
          chimmyBrief: BRIEF,
          coverage: [{ label: 'League chatter', reason: 'not ingested' }] as never,
        })}
      />,
    )
    expect(container.textContent).not.toContain('What this screen is not watching')
  })
})

describe('the first-kickoff line', () => {
  const LOCK = {
    countdown: 'in 3d 2h',
    countdownTo: '2026-09-04T00:20:00.000Z',
    countdownLabel: 'FIRST KICKOFF',
    kickoffLabel: 'NFL · Week 1',
    headline: 'Steelers at Bills',
    slots: [],
    awayClub: null,
    homeClub: null,
    openHref: '/league/l1',
    openLabel: 'Check Bla bla bla',
  } as unknown as NonNullable<Dash34Data['firstLock']>

  it('carries no raw UTC stamp in its label', () => {
    // Three zones on one screen was the bug: this line printed UTC while the
    // bands around it localised, on the one number someone sets an alarm by.
    const { container } = render(<Dash34Carryover data={data({ firstLock: LOCK })} />)
    expect(container.textContent).not.toMatch(/UTC/)
    expect(container.textContent).toContain('NFL · Week 1')
  })

  it('still renders the fixture and the coarse countdown', () => {
    const { container } = render(<Dash34Carryover data={data({ firstLock: LOCK })} />)
    expect(container.textContent).toContain('Steelers at Bills')
    expect(container.textContent).toMatch(/in \d/)
  })
})

describe('Dash34Coverage', () => {
  it('renders the disclosure, collapsed, with its count', () => {
    const { container } = render(
      <Dash34Coverage
        data={data({
          coverage: [
            { label: 'League chatter', reason: 'not ingested' },
            { label: 'Pending trade offers and waiver claims', reason: 'only completed are read' },
          ] as never,
        })}
      />,
    )
    expect(container.textContent).toContain('What this screen is not watching (2)')
    expect(container.querySelector('details')).toBeTruthy()
    // Collapsed by default — a footnote that opens itself is not a footnote.
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false)
  })

  it('renders nothing when there is nothing withheld, and when the read failed', () => {
    expect(render(<Dash34Coverage data={data()} />).container.innerHTML).toBe('')
    expect(render(<Dash34Coverage data={null} />).container.innerHTML).toBe('')
  })
})
