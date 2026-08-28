/**
 * The copy swap IS the fix — so it gets pinned as text, on every surface.
 *
 * `rosterFailed` only matters because of what it makes the screen SAY. The
 * dangerous state is not a crash: it is a healthy-looking page telling a signed-in
 * user "None of your players are playing right now" plus "Claim your team in one
 * of your leagues", when they have claimed one and their players may be on the
 * field. Two false statements, no error anywhere.
 *
 * The data-layer test (live-roster-failure.test.ts) proves the flag is set. This
 * proves the flag changes what a human reads, on all four surfaces it feeds:
 *
 *   /live        EmptyState      + LiveImpactPanel
 *   /core/live   EmptySlate      + its own impact panel
 *
 * ⚠ EACH CASE ASSERTS THE ABSENCE OF THE FALSE COPY, not just the presence of the
 * true copy. Rendering the honest message while ALSO leaving the "none of your
 * players are playing" line on screen would satisfy a presence-only assertion and
 * still ship the lie.
 *
 * ⚠ AND THE IMPACT PANELS ASSERT "0.0" IS GONE. A failed read leaves
 * `impact.totalPoints` at 0, so the panel would otherwise print "0.0 fantasy pts
 * scored live right now" — a measurement nobody took. An em dash is the house rule
 * for a number we do not have.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))

// next/image-backed and irrelevant to the copy under test.
vi.mock('@/components/MiniPlayerImg', () => ({
  default: () => <span data-testid="mini-player-img" />,
}))

import { LiveScoresClient } from '@/components/live/LiveScoresClient'
import { LiveImpactPanel } from '@/components/live/LiveImpactPanel'
import { LiveScores } from '@/components/core-app/screens/LiveScores'
import type { LivePageData, LiveImpact } from '@/lib/live/liveScoresPage'

const EMPTY_IMPACT: LiveImpact = {
  totalPoints: 0,
  livePlayers: 0,
  liveGames: 0,
  biggestMover: null,
  // NFL-only play feed; empty is the correct shape for every other tab.
  plays: [],
  upNext: [],
}

/** No games + no tie-ins: the state a failed roster read actually produces
 *  under the default `scope: 'my'`. */
function pageData(over: Partial<LivePageData> = {}): LivePageData {
  return {
    sport: 'NFL',
    scope: 'my',
    counts: [{ sport: 'NFL', label: 'NFL', slateCount: 0 }],
    games: [],
    impact: EMPTY_IMPACT,
    fetchedAt: new Date().toISOString(),
    hasRosterData: false,
    loadFailed: false,
    rosterFailed: false,
    ...over,
  } as LivePageData
}

const TRUE_COPY = /could not read your rosters/i
const FALSE_COPY = /None of your players are playing right now/i
const CLAIM_PROMPT = /Claim (your|a) team in one of your leagues/i

beforeEach(() => vi.clearAllMocks())

describe('/live — LiveScoresClient empty state', () => {
  it('says the rosters failed, and does NOT say your players are not playing', () => {
    render(<LiveScoresClient initial={pageData({ rosterFailed: true })} />)

    /*
     * getAllByText, not getByText: BOTH the empty state and the impact panel
     * carry this line, and that is correct — a user who reads only the sidebar
     * should not be left with the wrong story. A single-match assertion here
     * fails on the product being right.
     */
    expect(screen.getAllByText(TRUE_COPY).length).toBeGreaterThan(0)
    expect(screen.queryByText(FALSE_COPY)).toBeNull()
    expect(screen.queryByText(CLAIM_PROMPT)).toBeNull()
  })

  it('control: with no failure it keeps the ordinary empty copy', () => {
    render(<LiveScoresClient initial={pageData({ rosterFailed: false })} />)

    expect(screen.getByText(FALSE_COPY)).toBeInTheDocument()
    expect(screen.queryByText(TRUE_COPY)).toBeNull()
  })

  it('a dead slate still outranks a roster fault', () => {
    render(<LiveScoresClient initial={pageData({ loadFailed: true, rosterFailed: true })} />)

    // loadFailed is the larger fault and is checked first.
    expect(screen.getByText(/Scores could not be loaded/i)).toBeInTheDocument()
    expect(screen.queryByText(FALSE_COPY)).toBeNull()
  })
})

describe('/core/live — LiveScores empty slate', () => {
  it('says the rosters failed, and does NOT say your players are not playing', () => {
    render(<LiveScores data={pageData({ rosterFailed: true })} />)

    expect(screen.getAllByText(TRUE_COPY).length).toBeGreaterThan(0)
    expect(screen.queryByText(FALSE_COPY)).toBeNull()
    expect(screen.queryByText(CLAIM_PROMPT)).toBeNull()
  })

  it('control: with no failure it keeps the ordinary empty copy', () => {
    render(<LiveScores data={pageData({ rosterFailed: false })} />)

    expect(screen.getByText(FALSE_COPY)).toBeInTheDocument()
    expect(screen.queryByText(TRUE_COPY)).toBeNull()
  })
})

describe('impact panels — an unmeasured total must not render as 0.0', () => {
  it('/live LiveImpactPanel shows an em dash, not 0.0', () => {
    render(<LiveImpactPanel impact={EMPTY_IMPACT} hasRosterData={false} rosterFailed />)

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0.0')).toBeNull()
    expect(screen.queryByText(/fantasy pts scored live right now/i)).toBeNull()
  })

  it('control: a real zero IS 0.0 — the em dash means "unknown", not "none"', () => {
    render(<LiveImpactPanel impact={EMPTY_IMPACT} hasRosterData rosterFailed={false} />)

    expect(screen.getByText('0.0')).toBeInTheDocument()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('/core/live impact panel shows an em dash, not 0.0', () => {
    render(<LiveScores data={pageData({ rosterFailed: true })} />)

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0.0')).toBeNull()
  })
})
