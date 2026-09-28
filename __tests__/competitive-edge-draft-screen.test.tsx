import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * Draft HQ's Competitive Edge section (components/core-app/screens/DraftCompetitiveEdge.tsx): a lock for
 * a viewer without the plan, each rival's draft record for one with it, and a plain sentence when the
 * league cannot be read or no pick is matched to a manager yet.
 */

import { DraftCompetitiveEdge } from '@/components/core-app/screens/DraftCompetitiveEdge'
import DraftHq from '@/components/core-app/screens/DraftHq'
import { buildDraftEdge } from '@/lib/competitive-edge/draftEdge'
import type { DraftHqData } from '@/lib/core-app/draftHq'

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

const EDGE = buildDraftEdge({
  picks: [
    { ownerSleeperId: 'sl-tasha', season: 2024, round: 1, position: 'RB' },
    { ownerSleeperId: 'sl-tasha', season: 2024, round: 2, position: 'RB' },
    { ownerSleeperId: 'sl-tasha', season: 2025, round: 1, position: 'RB' },
    { ownerSleeperId: 'sl-tasha', season: 2025, round: 3, position: 'QB' },
  ],
  managers: [
    { ownerSleeperId: 'sl-you', name: 'You', teamExternalId: '1' },
    { ownerSleeperId: 'sl-tasha', name: 'Tasha', teamExternalId: '2' },
  ],
  viewerOwnerSleeperId: 'sl-you',
  unattributedSeasons: [2023],
})

describe('DraftCompetitiveEdge', () => {
  it('🛑 without the plan: the lock, and no rival’s picks', () => {
    render(<DraftCompetitiveEdge access={access(false)} edge={{ available: true, data: EDGE }} />)
    expect(screen.getByTestId('core-lock-competitive_edge')).toBeTruthy()
    expect(screen.queryByTestId('draft-competitive-edge')).toBeNull()
    expect(document.body.textContent).not.toContain('Tasha')
  })

  it('with it: each rival’s record, then what it is counted from and what it is not', () => {
    render(<DraftCompetitiveEdge access={access(true)} edge={{ available: true, data: EDGE }} />)
    const tasha = screen.getByTestId('draft-edge-rival-2').textContent ?? ''
    expect(tasha).toContain('Tasha drafted in 2 of the 2 drafts on file (2024–2025), 4 picks in all.')
    expect(tasha).toContain('Their first-round pick was at RB in 2 of their 2 drafts.')
    expect(tasha).toContain('They took a QB in rounds 1–3 in 1 of their 2 drafts.')
    const basis = screen.getByTestId('draft-competitive-edge-basis').textContent ?? ''
    expect(basis).toContain("Sleeper drafts (2024–2025)")
    expect(basis).toContain("Picks from 2023 aren't matched to a manager yet")
    expect(basis).toContain("not what they'll take")
    expect(screen.queryByTestId('draft-edge-rival-1')).toBeNull()
  })

  it('before launch it says it is free until then', () => {
    render(<DraftCompetitiveEdge access={access(true, true)} edge={{ available: true, data: EDGE }} />)
    expect(screen.getByTestId('core-free-until-competitive_edge')).toBeTruthy()
  })

  it('no matched picks yet: says so, rather than listing managers with empty records', () => {
    const empty = buildDraftEdge({
      picks: [],
      managers: [{ ownerSleeperId: 'sl-tasha', name: 'Tasha', teamExternalId: '2' }],
      viewerOwnerSleeperId: null,
      unattributedSeasons: [2024, 2025],
    })
    render(<DraftCompetitiveEdge access={access(true)} edge={{ available: true, data: empty }} />)
    expect(screen.getByTestId('draft-competitive-edge').textContent).toContain('No picks in this league')
    expect(screen.queryByTestId('draft-edge-rival-2')).toBeNull()
  })

  it('a league it cannot read gets the reason, not an empty section', () => {
    render(<DraftCompetitiveEdge access={access(true)} edge={{ available: false, reason: "ESPN leagues aren't connected yet." }} />)
    expect(screen.getByTestId('draft-competitive-edge').textContent).toContain("ESPN leagues aren't connected yet.")
  })
})

describe('Draft HQ screen', () => {
  const missing = { available: false as const, reason: 'x' }
  const DATA = {
    league: { id: 'lg-1', name: 'League', platform: 'sleeper', format: null },
    session: missing,
    pickSlots: missing,
    madePicks: missing,
    board: missing,
    grades: missing,
    lottery: missing,
    queue: missing,
    keepers: missing,
  } as unknown as DraftHqData

  it('mounts the section with what the page loaded', () => {
    render(<DraftHq data={DATA} edge={{ available: true, data: EDGE }} edgeAccess={access(true)} />)
    expect(screen.getByTestId('draft-competitive-edge')).toBeTruthy()
  })

  it('shows the lock when the page withheld the edge', () => {
    render(<DraftHq data={DATA} edge={null} edgeAccess={access(false)} />)
    expect(screen.getByTestId('core-lock-competitive_edge')).toBeTruthy()
  })

  it('draws nothing when the page loaded nothing and there is no lock to show', () => {
    render(<DraftHq data={DATA} />)
    expect(screen.queryByTestId('draft-competitive-edge')).toBeNull()
    expect(screen.queryByTestId('core-lock-competitive_edge')).toBeNull()
  })
})
