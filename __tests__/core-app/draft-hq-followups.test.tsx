/**
 * Draft HQ follow-ups (2026-11-13), from the live page on the owner's account:
 *   1. "KBI North Black is drafting — it's not your pick yet" over a paused draft whose card said
 *      "On the clock: You" — the paused draft waiting on you vanished from the headline, and "not your
 *      pick" was claimed for a draft whose slot we could not read.
 *   2. A live card with no "when do I pick" — the number you wait for.
 *   3. "Coming up" in alphabetical order with no dates.
 *   4. A footer with three counts in one line.
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const db = vi.hoisted(() => ({
  draftSession: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  leagueSettings: { findMany: vi.fn() },
  draftPick: { groupBy: vi.fn() },
  draftQueueEntry: { groupBy: vi.fn() },
  draftQueue: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { getDraftHqAll, type DraftHqAllData, type DraftHqAllRow } from '@/lib/core-app/draftHqAll'
import { draftHqHeadline, groupDrafts } from '@/lib/core-app/draftHqGuide'
import { draftHqGuideMessages } from '@/lib/core-app/messages/draftHqGuide'
import DraftHqBoard from '@/components/core-app/boards/DraftHqBoard'

const ORDER = [
  { slot: 1, rosterId: 'a', displayName: 'Alpha' },
  { slot: 2, rosterId: 'b', displayName: 'Beta' },
  { slot: 3, rosterId: 'c', displayName: 'Gamma' },
  { slot: 4, rosterId: 'd', displayName: 'Delta' },
]
const session = (over: Record<string, unknown> = {}) => ({
  id: 's1', leagueId: 'one', createdAt: new Date('2026-09-01'), status: 'in_progress', draftType: 'snake',
  rounds: 3, teamCount: 4, slotOrder: ORDER, nextOverallPick: 2, currentRoundNum: 1, thirdRoundReversal: false,
  tradedPicks: [], timerEndAt: null, startedAt: null, draftModeLabel: null, ...over,
})

describe('getDraftHqAll — your next pick and the draft date', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.draftSession.findMany.mockResolvedValue([session()])
    db.leagueTeam.findMany.mockResolvedValue([{ leagueId: 'one', externalId: 'a' }])
    db.leagueSettings.findMany.mockResolvedValue([])
    db.draftPick.groupBy.mockResolvedValue([])
    db.draftQueueEntry.groupBy.mockResolvedValue([])
    db.draftQueue.findMany.mockResolvedValue([])
  })

  it('walks a snake order to your next pick: slot 1 of 4, pick 2 on the clock → 2.04, six picks away', async () => {
    const out = await getDraftHqAll('u', [{ id: 'one', name: 'One' }])
    expect(out.rows[0]!.yourNextPick).toEqual({ overall: 8, round: 2, inRound: 4, away: 6 })
  })

  it('has no next pick when your team is not in the order', async () => {
    db.leagueTeam.findMany.mockResolvedValue([])
    const out = await getDraftHqAll('u', [{ id: 'one', name: 'One' }])
    expect(out.rows[0]!.yourNextPick).toBeNull()
    expect(out.rows[0]!.yourSlot).toBeNull()
  })

  it('carries an AllFantasy league’s draft date, and none for a league without one', async () => {
    db.draftSession.findMany.mockResolvedValue([session({ status: 'pre_draft' })])
    db.leagueSettings.findMany.mockResolvedValue([{ leagueId: 'one', draftDateUtc: new Date('2026-11-16T01:00:00Z') }])
    const out = await getDraftHqAll('u', [{ id: 'one', name: 'One' }])
    expect(out.rows[0]!.draftAt).toBe('2026-11-16T01:00:00.000Z')
  })
})

const row = (over: Partial<DraftHqAllRow> & Pick<DraftHqAllRow, 'leagueId'>): DraftHqAllRow => ({
  leagueName: over.leagueId,
  platform: 'sleeper',
  imageUrl: null,
  phase: 'live',
  rawStatus: 'in_progress',
  draftType: 'snake',
  rounds: 11,
  teamCount: 16,
  yourSlot: 4,
  picksMade: null,
  pickExpiresAt: null,
  onClockName: null,
  yoursOnClock: false,
  currentRound: 4,
  nextOverallPick: 51,
  queuedCount: 0,
  modeLabel: null,
  startedAt: null,
  yourNextPick: null,
  draftAt: null,
  ...over,
})

describe('draftHqHeadline — the paused draft waiting on you, and what it may claim', () => {
  const en = draftHqGuideMessages.en
  it('names a paused draft where you pick next even while another draft runs', () => {
    const h = draftHqHeadline([row({ leagueId: 'KBI' }), row({ leagueId: 'NBA', rawStatus: 'paused', yoursOnClock: true })])
    expect(h).toEqual({ kind: 'running', league: 'KBI', n: 1, known: true, pausedYours: 'NBA' })
    expect(en.headRunning('KBI', 1) + en.headPausedYours('NBA')).toBe('KBI is drafting — it’s not your pick yet · you pick next in NBA (paused)')
  })

  it('does not say "not your pick" for a draft whose slot it cannot read', () => {
    const h = draftHqHeadline([row({ leagueId: 'KBI', yourSlot: null })])
    expect(h).toMatchObject({ kind: 'running', known: false, pausedYours: null })
    expect(en.headRunningUnknown('KBI', 1)).toBe('KBI is drafting — open it to see when you pick')
  })
})

describe('groupDrafts — not started, soonest first', () => {
  it('orders dated drafts by date, then the undated by name', () => {
    const { groups } = groupDrafts([
      row({ leagueId: 'Alpha', phase: 'upcoming', rawStatus: 'pre_draft' }),
      row({ leagueId: 'Later', phase: 'upcoming', rawStatus: 'pre_draft', draftAt: '2026-11-20T00:00:00Z' }),
      row({ leagueId: 'Sooner', phase: 'upcoming', rawStatus: 'pre_draft', draftAt: '2026-11-15T00:00:00Z' }),
    ])
    expect(groups.comingUp.map((r) => r.leagueName)).toEqual(['Sooner', 'Later', 'Alpha'])
  })
})

describe('<DraftHqBoard /> — the follow-ups on screen', () => {
  const data: DraftHqAllData = {
    rows: [
      row({ leagueId: 'Live', yourNextPick: { overall: 57, round: 4, inRound: 9, away: 6 } }),
      row({ leagueId: 'Native', platform: 'native', phase: 'upcoming', rawStatus: 'pre_draft', draftAt: '2026-11-16T01:00:00Z' }),
      row({ leagueId: 'Undated', platform: 'native', phase: 'upcoming', rawStatus: 'pre_draft' }),
      row({ leagueId: 'Imported', platform: 'sleeper', phase: 'upcoming', rawStatus: 'pre_draft' }),
    ],
    counts: { live: 1, upcoming: 3, done: 0, unknown: 0 },
    withoutDraft: 47,
  }

  it('shows your next pick on a live card, and when each not-started draft happens', () => {
    const { container } = render(<DraftHqBoard data={data} allHref="/core/draft-hq?all=1" totalLeagues={51} />)
    const text = container.textContent ?? ''
    expect(text).toContain('Your next pick')
    expect(text).toContain('4.09 · 6 picks away')
    const dates = [...container.querySelectorAll('.af-dh-row-date')].map((e) => e.textContent)
    expect(dates).toEqual(['Drafts Sun, Nov 15, 8:00 PM ET', 'Draft date is on Sleeper', 'No draft date set'])
  })

  it('says one count on the footer line and keeps the rest behind its "?"', () => {
    const { container } = render(<DraftHqBoard data={data} allHref="/core/draft-hq?all=1" totalLeagues={51} />)
    const foot = container.querySelector('.af-bd-foot-text')!
    const why = foot.querySelector('details.af-dh-why')!
    expect(why).not.toBeNull()
    expect(why.textContent).toContain('47 leagues have no draft we can read.')
    expect(why.textContent).toContain('No queue built in AllFantasy')
    // Outside the "?", the line carries only the shown-of-total count.
    const outside = (foot.textContent ?? '').replace(why.textContent ?? '', '').trim()
    expect(outside).toBe('4 drafts in all.')
    expect(container.querySelector('.af-bd-foot-cta')?.textContent).toBe('See every league →')
  })
})
