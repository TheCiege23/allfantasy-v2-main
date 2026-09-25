import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * The Waivers screen's Competitive Edge section (components/core-app/screens/WaiverCompetitiveEdge.tsx):
 * a lock for a viewer without the plan, the facts for one with it, and a plain sentence when the league
 * cannot be read.
 */

vi.mock('@/components/core-app/WaiverLineupBoard', () => ({ WaiverLineupBoard: () => null }))
vi.mock('@/components/decide/WaiverIntel', () => ({ WaiverIntel: () => null }))
vi.mock('@/components/waivers/AIWaiverRecommendationsPanel', () => ({ default: () => null }))

import { WaiverCompetitiveEdge } from '@/components/core-app/screens/WaiverCompetitiveEdge'
import Waivers from '@/components/core-app/screens/Waivers'
import { buildWaiverEdge } from '@/lib/competitive-edge/waiverEdge'
import type { WaiversData } from '@/lib/core-app/waivers'

afterEach(cleanup)

const access = (unlocked: boolean, preLaunchFree = false) =>
  ({
    depth: 'competitive_edge',
    unlocked,
    hasPlan: unlocked && !preLaunchFree,
    preLaunchFree,
    startsAt: '2026-10-15T04:00:00.000Z',
    planName: 'AF Pro',
    label: 'Competitive Edge',
    upgradePath: '/pro',
  }) as never

const EDGE = buildWaiverEdge({
  season: 2026,
  usesFaab: true,
  claims: [
    { teamExternalId: '2', position: 'RB', bid: 18, atIso: '2026-09-01T00:00:00.000Z' },
    { teamExternalId: '2', position: 'RB', bid: 4, atIso: '2026-09-02T00:00:00.000Z' },
    { teamExternalId: '2', position: 'WR', bid: 0, atIso: '2026-09-03T00:00:00.000Z' },
  ],
  managers: [
    { teamExternalId: '1', name: 'You', faabRemaining: 40 },
    { teamExternalId: '2', name: 'Tasha', faabRemaining: 72 },
  ],
  viewerTeamExternalId: '1',
  asOf: '2026-09-25T12:44:20.000Z',
  stale: false,
})

describe('WaiverCompetitiveEdge', () => {
  it('🛑 without the plan: the lock, and no facts', () => {
    render(<WaiverCompetitiveEdge access={access(false)} edge={{ available: true, data: EDGE }} />)
    expect(screen.getByTestId('core-lock-competitive_edge')).toBeTruthy()
    expect(screen.queryByTestId('waiver-competitive-edge')).toBeNull()
    expect(document.body.textContent).not.toContain('Tasha')
  })

  it('with it: who can outbid you first, then each rival’s record, then what it is counted from', () => {
    render(<WaiverCompetitiveEdge access={access(true)} edge={{ available: true, data: EDGE }} />)
    expect(screen.getByTestId('waiver-edge-waiver.outbid_by').textContent).toBe(
      '1 of the 1 other managers has more FAAB left than your $40.',
    )
    const tasha = screen.getByTestId('waiver-edge-rival-2').textContent ?? ''
    expect(tasha).toContain('Tasha has $72 of FAAB left — more than your $40.')
    expect(tasha).toContain('Their biggest winning bid was $18 (RB).')
    const basis = screen.getByTestId('waiver-competitive-edge-basis').textContent ?? ''
    expect(basis).toContain('2026 season')
    expect(basis).toContain('wins only')
    expect(basis).toContain('not what they’ll bid'.replace('’', "'"))
  })

  it('before launch it says it is free until then', () => {
    render(<WaiverCompetitiveEdge access={access(true, true)} edge={{ available: true, data: EDGE }} />)
    expect(screen.getByTestId('core-free-until-competitive_edge')).toBeTruthy()
  })

  it('a league it cannot read gets the reason, not an empty section', () => {
    render(<WaiverCompetitiveEdge access={access(true)} edge={{ available: false, reason: "ESPN leagues aren't connected yet." }} />)
    expect(screen.getByTestId('waiver-competitive-edge').textContent).toContain("ESPN leagues aren't connected yet.")
  })
})

describe('Waivers screen', () => {
  const missing = { available: false as const, reason: 'x' }
  const DATA = {
    league: { id: 'lg-1', name: 'League', platform: 'sleeper', format: null },
    budget: missing,
    waiverPriority: missing,
    rosterLoad: missing,
    claimsQueued: missing,
    waiverType: missing,
    processTime: missing,
    tiebreak: missing,
    claimLimits: missing,
  } as unknown as WaiversData

  it('mounts the section with what the page loaded', () => {
    render(<Waivers data={DATA} edge={{ available: true, data: EDGE }} edgeAccess={access(true)} />)
    expect(screen.getByTestId('waiver-competitive-edge')).toBeTruthy()
  })

  it('draws nothing when the page loaded nothing and there is no lock to show', () => {
    render(<Waivers data={DATA} />)
    expect(screen.queryByTestId('waiver-competitive-edge')).toBeNull()
  })
})
