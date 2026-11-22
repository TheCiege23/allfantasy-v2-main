/**
 * "Who's next?" (lib/guillotine/nextChopPick.ts, nextChopPickStore.ts, GuillotineNextChopPick.tsx): a
 * chopped manager's weekly pick of the team the next chop takes, and the leaderboard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const db = vi.hoisted(() => ({
  events: [] as Array<{ leagueId: string; eventType: string; metadata: Record<string, unknown>; createdAt: Date }>,
  chopped: [] as Array<{ rosterId: string; choppedInPeriod: number | null }>,
  rosters: ['a', 'b', 'c', 'd', 'e'],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ sport: 'NBA', season: 2026 })) },
    guillotineRosterState: { findMany: vi.fn(async () => db.chopped) },
    roster: { findMany: vi.fn(async () => db.rosters.map((id) => ({ id }))) },
    guillotineEventLog: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string; eventType: string; metadata?: { equals: unknown } } }) =>
        db.events.filter((e) => e.leagueId === where.leagueId && e.eventType === where.eventType && (!where.metadata || e.metadata.season === where.metadata.equals))),
      create: vi.fn(async ({ data }: { data: { leagueId: string; eventType: string; metadata: Record<string, unknown> } }) => {
        db.events.push({ ...data, createdAt: new Date(Date.now() + db.events.length) })
        return data
      }),
    },
  },
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => ({ eliminationStartWeek: 2, eliminationEndWeek: 20 })) }))
vi.mock('@/lib/guillotine/lateStartSeats', () => ({ guillotineFantasyWeekAt: vi.fn(async () => 5) }))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({
  resolveRosterDisplayNames: vi.fn(async (_l: string, ids: string[]) => new Map(ids.map((id) => [id, `Team ${id.toUpperCase()}`]))),
}))

import { latestPicks, nextChopLeaderboard, openPickWeek, type NextChopPick } from '@/lib/guillotine/nextChopPick'
import { loadNextChopPickState, saveNextChopPick } from '@/lib/guillotine/nextChopPickStore'
import { GuillotineNextChopPick } from '@/components/guillotine/GuillotineNextChopPick'

const pick = (pickerRosterId: string, week: number, pickedRosterId: string, at = '2026-11-01T00:00:00Z'): NextChopPick => ({ pickerRosterId, week, pickedRosterId, at })

describe('the rules', () => {
  it('the latest pick a manager makes for a week is the one that counts', () => {
    expect(latestPicks([pick('x', 4, 'a', '2026-11-01T00:00:00Z'), pick('x', 4, 'b', '2026-11-02T00:00:00Z'), pick('x', 5, 'c')]))
      .toEqual([pick('x', 4, 'b', '2026-11-02T00:00:00Z'), pick('x', 5, 'c')])
  })

  it('one point for a pick that is chopped — either team on a double chop — and an unchopped week is not settled', () => {
    const chopped = new Map([['a', 3], ['b', 4], ['c', 4]])
    const board = nextChopLeaderboard([pick('x', 3, 'a'), pick('x', 4, 'c'), pick('y', 3, 'd'), pick('y', 4, 'b'), pick('y', 5, 'e')], chopped)
    expect(board).toEqual([
      { rosterId: 'x', correct: 2, settled: 2 },
      { rosterId: 'y', correct: 1, settled: 2 },
    ])
  })

  it('ties go to whoever needed fewer picks, then hold steady', () => {
    const board = nextChopLeaderboard([pick('z', 3, 'a'), pick('m', 3, 'a'), pick('m', 4, 'q')], new Map([['a', 3], ['b', 4]]))
    expect(board.map((r) => r.rosterId)).toEqual(['z', 'm'])
  })

  it('the open week is the one after the week being played, inside the chop window', () => {
    expect(openPickWeek({ calendarWeek: 5, eliminationStartWeek: 2, eliminationEndWeek: 20 })).toBe(6)
    expect(openPickWeek({ calendarWeek: 0, eliminationStartWeek: 2, eliminationEndWeek: 20 })).toBe(2)
    expect(openPickWeek({ calendarWeek: 20, eliminationStartWeek: 2, eliminationEndWeek: 20 })).toBeNull()
  })
})

describe('the store', () => {
  beforeEach(() => {
    db.events = []
    db.chopped = [{ rosterId: 'a', choppedInPeriod: 3 }, { rosterId: 'b', choppedInPeriod: 4 }]
  })

  it('a chopped manager picks a team still alive for next week; the latest pick replaces the last', async () => {
    expect(await saveNextChopPick({ leagueId: 'L1', viewerRosterId: 'a', userId: 'u-a', week: 6, pickedRosterId: 'c' })).toEqual({ ok: true, week: 6 })
    expect(await saveNextChopPick({ leagueId: 'L1', viewerRosterId: 'a', userId: 'u-a', week: 6, pickedRosterId: 'd' })).toEqual({ ok: true, week: 6 })
    expect(db.events[0]!.metadata).toEqual({ season: 2026, week: 6, pickerRosterId: 'a', pickedRosterId: 'c', userId: 'u-a' })
    const state = await loadNextChopPickState('L1', 'a')
    expect(state).toMatchObject({ week: 6, canPick: true, myPick: 'd' })
    expect(state!.candidates.map((c) => c.rosterId)).toEqual(['c', 'd', 'e'])
  })

  it('refuses a survivor, a week that has started or is not open, and a team already chopped', async () => {
    expect(await saveNextChopPick({ leagueId: 'L1', viewerRosterId: 'c', userId: 'u', week: 6, pickedRosterId: 'd' })).toEqual({ ok: false, reason: 'not_chopped' })
    expect(await saveNextChopPick({ leagueId: 'L1', viewerRosterId: null, userId: 'u', week: 6, pickedRosterId: 'd' })).toEqual({ ok: false, reason: 'not_chopped' })
    expect(await saveNextChopPick({ leagueId: 'L1', viewerRosterId: 'a', userId: 'u', week: 5, pickedRosterId: 'd' })).toEqual({ ok: false, reason: 'closed' })
    expect(await saveNextChopPick({ leagueId: 'L1', viewerRosterId: 'a', userId: 'u', week: 7, pickedRosterId: 'd' })).toEqual({ ok: false, reason: 'closed' })
    expect(await saveNextChopPick({ leagueId: 'L1', viewerRosterId: 'a', userId: 'u', week: 6, pickedRosterId: 'b' })).toEqual({ ok: false, reason: 'not_alive' })
    expect(db.events).toHaveLength(0)
  })

  it('the leaderboard names its managers, marks the viewer, and the viewer sees how their last pick went', async () => {
    // 'a' picked 'b' for week 4 — and 'b' was chopped in week 4.
    db.events.push({ leagueId: 'L1', eventType: 'next_chop_pick', metadata: { season: 2026, week: 4, pickerRosterId: 'a', pickedRosterId: 'b' }, createdAt: new Date('2026-10-20') })
    // Last season's pick does not count — not even one naming a team chopped in that week number this season.
    db.events.push({ leagueId: 'L1', eventType: 'next_chop_pick', metadata: { season: 2025, week: 3, pickerRosterId: 'a', pickedRosterId: 'a' }, createdAt: new Date('2025-10-20') })
    const state = await loadNextChopPickState('L1', 'a')
    expect(state!.leaderboard).toEqual([{ rosterId: 'a', name: 'Team A', correct: 1, settled: 1, isMe: true }])
    expect(state!.lastResult).toEqual({ week: 4, pickedName: 'Team B', correct: true })
    // A survivor sees the board but cannot pick.
    expect(await loadNextChopPickState('L1', 'c')).toMatchObject({ canPick: false, myPick: null })
  })
})

describe('the page', () => {
  const state = (over = {}) => ({
    week: 6, canPick: true, myPick: null as string | null,
    candidates: [{ rosterId: 'c', name: 'Team C' }, { rosterId: 'd', name: 'Team D' }],
    leaderboard: [{ rosterId: 'a', name: 'Team A', correct: 1, settled: 1, isMe: true }],
    lastResult: { week: 4, pickedName: 'Team B', correct: true },
    ...over,
  })

  it('a chopped manager picks and locks it in; the saved pick shows', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, nextChopPick: state({ myPick: 'd' }) }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<GuillotineNextChopPick leagueId="L1" state={state()} />)
    expect(screen.getByTestId('guillotine-next-chop-last').textContent).toContain('Week 4: you picked Team B — called it.')
    fireEvent.change(screen.getByTestId('guillotine-next-chop-select'), { target: { value: 'd' } })
    fireEvent.click(screen.getByTestId('guillotine-next-chop-save'))
    await waitFor(() => expect(screen.getByTestId('guillotine-next-chop-mine').textContent).toBe('Your pick: Team D'))
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ action: 'next_chop_pick', week: 6, rosterId: 'd' })
    expect(screen.getByTestId('guillotine-next-chop-row-a').textContent).toContain('You · Team A')
    vi.unstubAllGlobals()
  })

  it('a refused pick says why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'That week has started, so picks for it are closed.' }) })))
    render(<GuillotineNextChopPick leagueId="L1" state={state()} />)
    fireEvent.change(screen.getByTestId('guillotine-next-chop-select'), { target: { value: 'c' } })
    fireEvent.click(screen.getByTestId('guillotine-next-chop-save'))
    await screen.findByText('That week has started, so picks for it are closed.')
    vi.unstubAllGlobals()
  })

  it('a survivor sees the leaderboard only; with nobody playing yet, the section is not shown at all', () => {
    const { unmount } = render(<GuillotineNextChopPick leagueId="L1" state={state({ canPick: false })} />)
    expect(screen.queryByTestId('guillotine-next-chop-select')).toBeNull()
    expect(screen.getByTestId('guillotine-next-chop-board')).toBeTruthy()
    unmount()
    render(<GuillotineNextChopPick leagueId="L1" state={state({ canPick: false, leaderboard: [] })} />)
    expect(screen.queryByTestId('guillotine-next-chop-pick')).toBeNull()
  })
})
