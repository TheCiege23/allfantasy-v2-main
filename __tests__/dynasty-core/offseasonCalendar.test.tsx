// @vitest-environment jsdom
/** The dynasty offseason calendar (phase 13): one timeline, with dates from the rules that act on them. */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  league: vi.fn(),
  roster: vi.fn(),
  elevated: vi.fn(async () => false),
  season: vi.fn(),
  leagueSettings: vi.fn(async () => null),
  draftState: vi.fn(async () => 'none'),
  plan: vi.fn(async () => true),
  taxi: vi.fn(async () => null),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.league },
    roster: { findFirst: m.roster },
    redraftSeason: { findFirst: m.season },
    leagueSettings: { findUnique: m.leagueSettings },
  },
}))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/lib/redraft/offseason/startDynastyNewSeason', () => ({ rookieDraftState: m.draftState }))
vi.mock('@/lib/redraft/offseason/openRookieDraftsOnCalendar', () => ({ ROOKIE_DRAFT_AUTO_OPENED_METADATA_KEY: 'rookieDraftAutoOpened' }))
vi.mock('@/lib/dynasty-core/rookieDraftAutoOpenPlan', () => ({ commissionerHasRookieDraftAutoOpenPlan: m.plan }))
vi.mock('@/lib/taxi/taxiRulesService', () => ({ loadTaxiEnforcement: m.taxi }))

import { offseasonCalendar, type OffseasonCalendarInput } from '@/lib/dynasty-core/offseasonCalendar'
import { readOffseasonCalendar } from '@/lib/dynasty-core/offseasonCalendarService'
import { OffseasonCalendar } from '@/components/core-app/commissioner/OffseasonCalendar'

const STARTED = new Date('2027-01-10T00:00:00Z')
const OPENS = new Date('2027-05-01T16:00:00Z')
const base: OffseasonCalendarInput = {
  season: 2027,
  offseasonStartedAt: STARTED,
  window: { sport: 'NFL', season: 2027, opensAt: OPENS, closesAt: null, source: 'sport_default' },
  autoOpen: { autoOpen: true, source: 'plan_default' },
  autoStartDays: 7,
  draft: 'none',
  autoOpened: null,
  draftDate: null,
  liveOrderOn: true,
  taxi: { promotionDeadlineWeek: 10, lockAfterWeek: 4 },
  now: STARTED,
}
const step = (steps: ReturnType<typeof offseasonCalendar>, key: string) => steps.find((s) => s.key === key)!

describe('offseasonCalendar', () => {
  it('with auto-open and auto-start on, AllFantasy opens and starts the draft on planned dates', () => {
    const s = offseasonCalendar(base)
    expect(s.map((x) => x.key)).toEqual(['season_over', 'rookie_order', 'draft_opens', 'draft_starts', 'kickoff', 'taxi'])
    expect(step(s, 'draft_opens')).toMatchObject({ at: OPENS.toISOString(), estimated: true, byAllFantasy: true })
    // Seven days after the day it opens, at 00:00 UTC of the next day.
    expect(step(s, 'draft_starts')).toMatchObject({ at: '2027-05-09T00:00:00.000Z', estimated: true, byAllFantasy: true })
    expect(step(s, 'taxi').en).toBe('In 2027, nobody joins the taxi squad after week 4 and taxi promotions close after week 10. AllFantasy warns every owner in that week.')
  })

  it('with auto-open off, the commissioner creates and starts it, and no start date is guessed', () => {
    const s = offseasonCalendar({ ...base, autoOpen: { autoOpen: false, source: 'free_default' }, liveOrderOn: false, taxi: null })
    expect(step(s, 'draft_opens')).toMatchObject({ byAllFantasy: false, en: expect.stringContaining('commissioner creates the draft') })
    expect(step(s, 'draft_starts')).toMatchObject({ at: null, byAllFantasy: false })
    expect(step(s, 'rookie_order').byAllFantasy).toBe(false)
    expect(s.find((x) => x.key === 'taxi')).toBeUndefined()
  })

  it('once opened, shows what actually happened and the start AllFantasy scheduled', () => {
    const opened = new Date('2027-05-01T17:00:00Z')
    const startsAt = new Date('2027-05-09T00:00:00Z')
    const s = offseasonCalendar({ ...base, draft: 'open', autoOpened: { openedAt: opened, startsAt } })
    expect(step(s, 'draft_opens')).toMatchObject({ at: opened.toISOString(), done: true, estimated: false })
    expect(step(s, 'draft_starts')).toMatchObject({ at: startsAt.toISOString(), estimated: false, done: false })
    expect(offseasonCalendar({ ...base, draft: 'complete' }).find((x) => x.key === 'draft_starts')).toMatchObject({ done: true })
  })
})

describe('readOffseasonCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.league.mockResolvedValue({ id: 'L', userId: 'commish', platform: 'allfantasy', settings: { dynasty_rookie_draft_calendar: { autoStartDays: 7 } }, leagueType: 'dynasty', isDynasty: true, lifecycleMetadata: {} })
    m.roster.mockResolvedValue({ id: 'r1' })
    m.season.mockResolvedValue({ id: 's2027', season: 2027, status: 'setup', createdAt: STARTED, currentWeek: 0, sport: 'NFL' })
  })

  it('reads the calendar for a member, ignoring last year’s draft date', async () => {
    m.leagueSettings.mockResolvedValueOnce({ draftDateUtc: new Date('2026-05-09T00:00:00Z') } as never)
    const r = await readOffseasonCalendar('L', 'member', STARTED)
    if (!r.ok || !r.view) throw new Error('no view')
    expect(r.view.season).toBe(2027)
    expect(r.view.steps.find((s) => s.key === 'draft_starts')).toMatchObject({ estimated: true, byAllFantasy: true })
  })

  it('refuses a non-member, and is empty outside the offseason or in a non-dynasty league', async () => {
    m.roster.mockResolvedValueOnce(null)
    expect(await readOffseasonCalendar('L', 'stranger', STARTED)).toEqual({ ok: false, status: 403 })
    m.season.mockResolvedValueOnce(null)
    expect(await readOffseasonCalendar('L', 'member', STARTED)).toEqual({ ok: true, view: null })
    m.league.mockResolvedValueOnce({ id: 'L', userId: 'c', platform: 'allfantasy', settings: {}, leagueType: 'redraft', isDynasty: false, lifecycleMetadata: {} })
    expect(await readOffseasonCalendar('L', 'member', STARTED)).toEqual({ ok: true, view: null })
  })
})

describe('OffseasonCalendar card', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('lists each step and marks what AllFantasy does', async () => {
    const steps = offseasonCalendar(base)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ calendar: { season: 2027, steps } }), { status: 200 })))
    render(<OffseasonCalendar leagueId="L" />)
    expect(await screen.findByTestId('offseason-step-draft_opens')).toHaveTextContent('About May 1, 2027 — AllFantasy opens the rookie draft. (AllFantasy does this)')
    expect(screen.getByTestId('offseason-step-season_over')).toHaveAttribute('data-done', 'true')
  })
})
