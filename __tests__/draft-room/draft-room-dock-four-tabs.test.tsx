/**
 * Draft room Phase 2 (2026-11-19): the side dock goes from eight tabs to four, My team reads like a
 * lineup (plain slot names, BN, bye week, draft pick), and the queue finds headshots by name.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DraftRightDockTabs } from '@/components/app/draft-room/DraftRightDockTabs'
import { ResultsRosterPanel } from '@/components/app/draft-room/ResultsRosterPanel'
import { queueNameKey } from '@/components/app/draft-room/QueuePanel'
import { buildOrderedRosterSlots } from '@/lib/draft-room/rosterSlotOrder'

afterEach(cleanup)
beforeEach(() => window.localStorage.clear())

const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)

describe('the dock has four tabs', () => {
  it('reads Queue, My team, Chimmy, Chat', () => {
    render(<DraftRightDockTabs queueBody={<div />} rosterBody={<div />} chimmyBody={<div />} chatBody={<div />} />)
    expect(tabs()).toEqual(['Queue', 'My team', 'Chimmy', 'Chat'])
  })

  it('opens Chimmy for someone whose last tab was Intel, AF Legacy or Activity', () => {
    for (const old of ['intel', 'war_room', 'activity']) {
      window.localStorage.setItem('af:draft-right-dock-active-tab', old)
      render(<DraftRightDockTabs queueBody={<div />} rosterBody={<div />} chimmyBody={<div>chimmy</div>} chatBody={<div />} />)
      expect(screen.getByTestId('draft-right-dock').getAttribute('data-active-tab')).toBe('chimmy')
      cleanup()
    }
  })

  it('adds Teams only in an auction', () => {
    render(<DraftRightDockTabs queueBody={<div />} rosterBody={<div />} chimmyBody={<div />} chatBody={<div />} teamsBody={<div />} />)
    expect(tabs()).toEqual(['Queue', 'Teams', 'My team', 'Chimmy', 'Chat'])
  })
})

describe('My team', () => {
  it('uses plain slot names and BN, never numbered slots', () => {
    const labels = buildOrderedRosterSlots({ starterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 1, DST: 1 }, benchSlots: 3 })
      .map((s) => s.label)
    expect(labels).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'SF', 'DEF', 'K', 'BN', 'BN', 'BN'])
  })

  it('shows each player\'s bye week and draft pick, and warns when 3 starters share a bye', () => {
    const picks = [
      { rosterId: 'r1', playerName: 'Core Signal', position: 'QB', team: 'KC', overall: 3, byeWeek: 7, pickLabel: '1.03' },
      { rosterId: 'r1', playerName: 'Atlas Runner', position: 'RB', team: 'NYJ', overall: 18, byeWeek: 7, pickLabel: '2.08' },
      { rosterId: 'r1', playerName: 'Blaze Catcher', position: 'WR', team: 'DAL', overall: 23, byeWeek: 7, pickLabel: '3.03' },
      { rosterId: 'r1', playerName: 'Delta Edge', position: 'TE', team: 'SEA', overall: 38, byeWeek: null, pickLabel: '4.08' },
    ]
    render(
      <ResultsRosterPanel teams={[{ rosterId: 'r1', displayName: 'You', isCurrentUser: true }]} picks={picks}
        currentUserRosterId="r1" starterSlots={{ QB: 1, RB: 2, WR: 2, TE: 1 }} benchSlots={2} />,
    )
    expect(screen.getByTestId('results-roster-panel-starters-bye-0').textContent).toBe('BYE 7')
    expect(screen.getByTestId('results-roster-panel-starters-pick-0').textContent).toBe('1.03')
    expect(screen.getByTestId('results-roster-panel-bye-stack').textContent).toContain('3 starters are off in week 7')
    // An unknown bye is a dash, never a guess.
    const te = [...document.querySelectorAll('[data-slot-label="TE"]')][0] as HTMLElement
    expect(te.textContent).toContain('BYE —')
    expect(document.body.textContent).not.toMatch(/taxi/i)
  })
})

describe('queue headshots', () => {
  it('match a queued player to the pool by name and position when the ids differ', () => {
    expect(queueNameKey("Marvin Harrison Jr.", 'WR')).toBe(queueNameKey('Marvin Harrison', 'wr'))
    expect(queueNameKey('Ja\'Marr Chase', 'WR')).toBe('name:jamarrchase|WR')
    expect(queueNameKey('', 'WR')).toBeNull()
  })
})
