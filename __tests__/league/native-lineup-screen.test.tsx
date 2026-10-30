/** Native Lineup screen (handoff 2026-10-11 §3): optimise + per-game lock, against mocked routes. */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))
vi.mock('@/lib/league/lineup-lock', () => ({ evaluateLineupLock: () => ({ locked: false, policy: 'football_weekly' }) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }))
// Pointer drags are impractical in jsdom: keep the real DndContext but capture its props so a test can
// call `onDragEnd` exactly as dnd-kit would after a drop.
const dnd = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dnd-kit/core')>()
  const R = await import('react')
  return {
    ...real,
    DndContext: (props: Record<string, unknown>) => {
      dnd.props = props
      return R.createElement(real.DndContext as never, props as never)
    },
  }
})

import { toast } from 'sonner'
import { NativeLineupScreen } from '@/components/league/native/screens/NativeLineupScreen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(toast.error).mockClear()
  dnd.props = null
})

const league = { id: 'lg1', name: 'Blah', sport: 'NFL', season: 2026, currentWeek: 5, teamCount: 12, platform: 'allfantasy', format: 'redraft', settings: {} } as unknown as UserLeague

function stubFetch(routes: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const key = Object.keys(routes).find((k) => url.includes(k))
      if (!key) return new Response(JSON.stringify({ error: 'nope' }), { status: 404 })
      return new Response(JSON.stringify(routes[key]), { status: 200 })
    }),
  )
  return calls
}

const wire = (id: string, name: string, position: string, projectedPoints: number) => ({
  id, name, position, team: 'PHI', sport: 'NFL', headshotUrl: null, imageUrl: null, teamLogoUrl: null, injuryStatus: null,
  fantasyPointsPerGame: null, projectedPoints, adp: null, aiAdp: null, aiAdpSampleSize: null, collegeClass: '', collegeClassLabel: null,
  soccerLeague: null, nflRookieIsRookie: null, nflRookieSource: null, lowConfidence: false, profileSource: null, statsSource: null,
  projectionsSource: null, normalizedStats: {}, normalizedProjections: {}, product: { unified: {}, yearsExp: null },
})
const roster = (unifiedRoster: unknown[]) => ({
  rosterId: 'ros1', leagueWeek: 5, canEditLineup: true, faabRemaining: 86, lineupLockHelp: 'Each game locks at kickoff.',
  starterSlots: [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
  ],
  roster: { lineup_sections: { starters: [{ id: 'qb1' }, { id: 'rb1' }], bench: [{ id: 'rb2' }], ir: [], taxi: [], devy: [] } },
  unifiedRoster,
})
const team = { id: 't', teamName: "TheCiege26's Team", wins: 3, losses: 1, ties: 0, pointsFor: 478.6, currentRank: 2 } as never

describe('NativeLineupScreen', () => {
  it('Optimize lineup saves the best projected legal lineup through the existing save route', async () => {
    const calls = stubFetch({
      '/api/league/roster': roster([wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2)]),
      '/claims': { claims: [{ status: 'pending' }, { status: 'pending' }] },
      '/state': { state: {} },
      '/settings': { waiverType: 'faab', faabBudget: 100 },
      '/api/leagues/roster/save': { ok: true },
    })
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    expect(await screen.findByText('Jalen Hurts')).toBeTruthy()
    expect(screen.getByText('3–1 · 2nd place · PF 478.6')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('/ 100')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Optimize lineup' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/leagues/roster/save')).toBe(true))
    const body = JSON.parse(String(calls.find((c) => c.url === '/api/leagues/roster/save')!.init!.body))
    expect(body).toMatchObject({ leagueId: 'lg1', rosterId: 'ros1', week: 5 })
    expect(body.roster.starters.map((p: { id: string }) => p.id)).toEqual(['qb1', 'rb2'])
    expect(body.roster.bench.map((p: { id: string }) => p.id)).toEqual(['rb1'])
  })

  it('a player whose game has kicked off is locked and cannot be moved', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString()
    stubFetch({
      '/api/league/roster': roster([{ ...wire('qb1', 'Jalen Hurts', 'QB', 22.4), nflRedraftGameContext: { isByeWeek: false, opponent: { teamAbbr: 'NYG' }, homeAway: 'home', kickoffTimeIso: past, gameStatus: 'scheduled', weather: { unavailable: true }, providerFreshness: { warnings: [] }, weatherFreshness: { warnings: [] } } }, wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2)]),
      '/claims': { claims: [] },
      '/state': { state: {} },
      '/settings': {},
    })
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Jalen Hurts')
    const lockedBtn = screen.getByRole('button', { name: 'Locked' }) as HTMLButtonElement
    expect(lockedBtn.disabled).toBe(true)
    expect(screen.getByText(/PHI · vs NYG/)).toBeTruthy()
    // Moving the bench RB in offers the RB slot only; the QB never appears as a target.
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' }).at(-1)!)
    expect(screen.getByText(/Start Bijan Robinson in/)).toBeTruthy()
    expect(screen.getByText('Replace Tyjae Spears')).toBeTruthy()
  })

  it('a daily-lineup league gets a day picker: today is editable, a past day shows what scored', async () => {
    const day = (d: string, status: string, slots: Record<string, string>, points: Record<string, number>, starterPoints: number) => ({ day: d, status, slots, points, starterPoints })
    const calls = stubFetch({
      '/api/league/roster': {
        ...roster([wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2)]),
        lineupLock: { lockedPlayerIds: ['rb1'] },
        dailyLineups: {
          week: 1,
          today: '2026-10-21',
          weekPoints: 31.5,
          startedPoints: { qb1: 20, rb2: 11.5 },
          days: [
            day('2026-10-20', 'past', { qb1: 'QB', rb2: 'RB', rb1: 'bench' }, { qb1: 20, rb2: 11.5, rb1: 4 }, 31.5),
            day('2026-10-21', 'today', { qb1: 'QB', rb1: 'RB', rb2: 'bench' }, {}, 0),
            day('2026-10-22', 'future', { qb1: 'QB', rb1: 'RB', rb2: 'bench' }, {}, 0),
          ],
        },
      },
      '/claims': { claims: [] },
      '/state': { state: {} },
      '/settings': {},
    })
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Jalen Hurts')
    expect(screen.getByTestId('daily-day-picker')).toBeTruthy()
    expect(screen.getByText(/Changes apply today/)).toBeTruthy()
    // The server's per-player lock wins: Spears' game today has started.
    expect((screen.getByRole('button', { name: 'Locked' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Tue/ }))
    expect(await screen.findByText(/is over/)).toBeTruthy()
    expect(screen.getByText('31.5 pts')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: 'Move' })).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /Thu/ }))
    expect(await screen.findByText(/carries forward/)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: 'Move' })).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getAllByRole('button', { name: 'Move' }).length).toBeGreaterThan(0)
    expect(calls.some((c) => c.url === '/api/leagues/roster/save')).toBe(false)
  })

  it('a weekly league shows no day picker', async () => {
    stubFetch({
      '/api/league/roster': roster([wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2)]),
      '/claims': { claims: [] },
      '/state': { state: {} },
      '/settings': {},
    })
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Jalen Hurts')
    expect(screen.queryByTestId('daily-day-picker')).toBeNull()
  })

  const saves = (calls: Array<{ url: string; init?: RequestInit }>) =>
    calls.filter((c) => c.url === '/api/leagues/roster/save').map((c) => JSON.parse(String(c.init!.body)) as { roster: Record<string, Array<{ id: string; status?: string }>> })
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id)
  const drop = (active: string, over: string | null) =>
    act(() => {
      ;(dnd.props!.onDragEnd as (e: unknown) => void)({ active: { id: active, data: { current: undefined } }, over: over ? { id: over, data: { current: undefined } } : null, delta: { x: 0, y: 0 }, collisions: null, activatorEvent: null })
    })
  const baseRoutes = (unified: unknown[], extra: Record<string, unknown> = {}) => ({
    '/api/league/roster': { ...roster(unified), ...extra },
    '/claims': { claims: [] },
    '/state': { state: {} },
    '/settings': {},
    '/api/leagues/roster/save': { ok: true },
  })
  const three = () => [wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2)]

  it('click: starting a bench player in an occupied slot still swaps through the save route', async () => {
    const calls = stubFetch(baseRoutes(three()))
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Bijan Robinson')
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' }).at(-1)!)
    fireEvent.click(screen.getByText('Replace Tyjae Spears'))
    await waitFor(() => expect(saves(calls)).toHaveLength(1))
    expect(ids(saves(calls)[0].roster.starters)).toEqual(['qb1', 'rb2'])
    expect(ids(saves(calls)[0].roster.bench)).toEqual(['rb1'])
  })

  it('drag: dropping a bench player onto an occupied slot swaps them via the same save', async () => {
    const calls = stubFetch(baseRoutes(three()))
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Bijan Robinson')
    expect(dnd.props).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Drag Bijan Robinson' })).toBeTruthy()
    drop('player:rb2', 'slot:1')
    await waitFor(() => expect(saves(calls)).toHaveLength(1))
    expect(ids(saves(calls)[0].roster.starters)).toEqual(['qb1', 'rb2'])
    expect(ids(saves(calls)[0].roster.bench)).toEqual(['rb1'])
  })

  it('drag: an ineligible drop is rejected and nothing is saved', async () => {
    const calls = stubFetch(baseRoutes(three()))
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Bijan Robinson')
    drop('player:rb2', 'slot:0')
    expect(toast.error).toHaveBeenCalledWith('Not eligible for QB.')
    await new Promise((r) => setTimeout(r, 20))
    expect(saves(calls)).toHaveLength(0)
  })

  it('a locked player has no drag handle, shows the lock reason, and a drop of him is refused', async () => {
    const calls = stubFetch(baseRoutes(three(), { lineupLock: { locked: false, lockedPlayerIds: ['rb1'], perPlayerReasons: { rb1: 'Locked for today: game started' } } }))
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Tyjae Spears')
    expect(screen.queryByRole('button', { name: 'Drag Tyjae Spears' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Drag Bijan Robinson' })).toBeTruthy()
    expect(screen.getByText('Locked for today: game started')).toBeTruthy()
    drop('player:rb1', 'bench')
    drop('player:rb2', 'slot:1')
    await new Promise((r) => setTimeout(r, 20))
    expect(saves(calls)).toHaveLength(0)
    expect(toast.error).toHaveBeenCalled()
  })

  it('benching a starter with no replacement leaves his slot empty (click and drag)', async () => {
    const calls = stubFetch(baseRoutes(three()))
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Tyjae Spears')
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' })[1])
    fireEvent.click(screen.getByRole('button', { name: /Move to bench/ }))
    await waitFor(() => expect(saves(calls)).toHaveLength(1))
    expect(ids(saves(calls)[0].roster.starters)).toEqual(['qb1'])
    expect(ids(saves(calls)[0].roster.bench)).toEqual(['rb2', 'rb1'])
    // One save at a time: wait for the first to settle before dragging.
    await waitFor(() => expect((screen.getAllByRole('button', { name: 'Move' })[0] as HTMLButtonElement).disabled).toBe(false))
    drop('player:qb1', 'bench')
    await waitFor(() => expect(saves(calls)).toHaveLength(2))
    expect(ids(saves(calls)[1].roster.bench)).toContain('qb1')
  })

  describe('slot positions survive a reload', () => {
    // QB, RB, FLEX. The manager emptied RB and kept Bijan in FLEX.
    const flexSlots = [
      { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
      { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
      { index: 2, label: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], isFlexible: true },
    ]
    const flexRoutes = (starters: Array<Record<string, unknown>>) => ({
      ...baseRoutes(three()),
      '/api/league/roster': {
        ...roster(three()),
        starterSlots: flexSlots,
        roster: { lineup_sections: { starters, bench: [{ id: 'rb1', position: 'RB' }], ir: [], taxi: [], devy: [] } },
      },
    })
    const starterNames = (container: HTMLElement) =>
      [...container.querySelectorAll('.nls-rows')[0].querySelectorAll('li strong')].map((el) => el.textContent?.trim())

    it('loads the saved positions: the empty slot stays where the manager left it', async () => {
      stubFetch(flexRoutes([{ id: 'qb1', position: 'QB', slotIndex: 0 }, { id: 'rb2', position: 'RB', slotIndex: 2 }]))
      const { container } = render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
      await screen.findByText('Bijan Robinson')
      expect(starterNames(container)).toEqual(['Jalen Hurts', 'Empty', 'Bijan Robinson'])
    })

    it('an old lineup without positions is re-seated as before', async () => {
      stubFetch(flexRoutes([{ id: 'qb1', position: 'QB' }, { id: 'rb2', position: 'RB' }]))
      const { container } = render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
      await screen.findByText('Bijan Robinson')
      expect(starterNames(container)).toEqual(['Jalen Hurts', 'Bijan Robinson', 'Empty'])
    })

    it('every saved starter carries his slot index', async () => {
      const calls = stubFetch(flexRoutes([{ id: 'qb1', position: 'QB', slotIndex: 0 }, { id: 'rb2', position: 'RB', slotIndex: 2 }]))
      render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
      await screen.findByText('Bijan Robinson')
      fireEvent.click(screen.getAllByRole('button', { name: 'Move' })[0])
      fireEvent.click(screen.getByRole('button', { name: /Move to bench/ }))
      await waitFor(() => expect(saves(calls)).toHaveLength(1))
      const sent = saves(calls)[0].roster as unknown as Record<string, Array<{ id: string; slotIndex?: number }>>
      expect(sent.starters.map((r) => [r.id, r.slotIndex])).toEqual([['rb2', 2]])
      expect(sent.bench.every((r) => r.slotIndex === undefined)).toBe(true)
    })
  })

  it('IR: an eligible injured bench player moves to IR, and an IR player moves back to the bench', async () => {
    const hurt = { ...wire('rb2', 'Bijan Robinson', 'RB', 0), injuryStatus: 'IR' }
    const calls = stubFetch(
      baseRoutes([wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), hurt], {
        slotLimits: { starters: 2, bench: 5, ir: 1, taxi: 0, devy: 0 },
        irRules: { irAllowOut: false, irAllowCovid: false, irAllowSuspended: false, irAllowNA: false, irAllowDNR: false, irAllowDoubtful: false },
      }),
    )
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Bijan Robinson')
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' }).at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: /Move to IR/ }))
    await waitFor(() => expect(saves(calls)).toHaveLength(1))
    const first = saves(calls)[0].roster
    expect(ids(first.ir)).toEqual(['rb2'])
    expect(ids(first.bench)).toEqual([])
    // The server validates IR from the row status, so the real designation must be sent.
    expect(first.ir[0].status).toBe('ir')
    // Healthy players get no IR control.
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' })[1])
    expect(screen.queryByRole('button', { name: /Move to IR/ })).toBeNull()
  })

  it('the bench shows every bench spot the league set: filled players, then open slots', async () => {
    stubFetch(baseRoutes([wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2)], {
      slotLimits: { starters: 2, bench: 3, ir: 0, taxi: 0, devy: 0 },
    }))
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Bijan Robinson')
    expect(screen.getAllByTestId('bench-open-slot')).toHaveLength(2)
    expect(screen.getByText('1 / 3')).toBeTruthy()
    expect(screen.queryByText('No one on the bench.')).toBeNull()
  })

  it('IR: an IR player moves back out to the bench', async () => {
    const hurt = { ...wire('rb3', 'Breece Hall', 'RB', 0), injuryStatus: 'IR' }
    const r = roster([wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2), hurt])
    const calls = stubFetch({
      ...baseRoutes([]),
      '/api/league/roster': { ...r, slotLimits: { starters: 2, bench: 5, ir: 1, taxi: 0, devy: 0 }, roster: { lineup_sections: { starters: [{ id: 'qb1' }, { id: 'rb1' }], bench: [{ id: 'rb2' }], ir: [{ id: 'rb3' }], taxi: [], devy: [] } } },
    })
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Breece Hall')
    fireEvent.click(screen.getByRole('button', { name: /Move Breece Hall to bench/ }))
    await waitFor(() => expect(saves(calls)).toHaveLength(1))
    expect(ids(saves(calls)[0].roster.ir)).toEqual([])
    expect(ids(saves(calls)[0].roster.bench)).toEqual(['rb2', 'rb3'])
  })
})
describe('NativeLineupScreen — tap to swap', () => {
  const routes = (r = roster([wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2)])) => ({
    '/api/league/roster': r,
    '/claims': { claims: [] },
    '/state': { state: {} },
    '/settings': {},
    '/api/leagues/roster/save': { ok: true },
  })
  const tapOn = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }))
  const saves = (calls: Array<{ url: string; init?: RequestInit }>) =>
    calls.filter((c) => c.url === '/api/leagues/roster/save').map((c) => JSON.parse(String(c.init!.body)) as { roster: Record<string, Array<{ id: string }>> })

  it('tap a bench player, then the starter he replaces: they swap and the lineup saves', async () => {
    const calls = stubFetch(routes())
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Bijan Robinson')
    tapOn('Bijan Robinson')
    expect(screen.getByRole('button', { name: /^Bijan Robinson.*Selected/ }).getAttribute('aria-pressed')).toBe('true')
    // While he waits, the RB row says it can take him and the QB row says it cannot.
    expect(screen.getByRole('button', { name: /^Tyjae Spears.*Tap to move here/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Jalen Hurts.*Not a legal move/ })).toBeTruthy()
    tapOn('Tyjae Spears')
    await waitFor(() => expect(saves(calls)).toHaveLength(1))
    const sent = saves(calls)[0].roster
    expect(sent.starters.map((p) => p.id)).toEqual(['qb1', 'rb2'])
    expect(sent.bench.map((p) => p.id)).toEqual(['rb1'])
  })

  it('an illegal second tap saves nothing and says why; tapping the same player twice lets go', async () => {
    const calls = stubFetch(routes())
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Bijan Robinson')
    tapOn('Bijan Robinson')
    tapOn('Jalen Hurts')
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Not eligible for QB.')
    expect(saves(calls)).toHaveLength(0)
    tapOn('Tyjae Spears')
    tapOn('Tyjae Spears')
    expect(screen.queryByRole('button', { name: /Selected/ })).toBeNull()
    expect(saves(calls)).toHaveLength(0)
  })

  it('taxi squad: tap a taxi player, then "Move to bench" in the bench header', async () => {
    const r = {
      ...roster([wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2), wire('tx1', 'Rookie Back', 'RB', 3.1)]),
      slotLimits: { starters: 2, bench: 5, ir: 0, taxi: 3, devy: 0 },
      roster: { lineup_sections: { starters: [{ id: 'qb1' }, { id: 'rb1' }], bench: [{ id: 'rb2' }], ir: [], taxi: [{ id: 'tx1' }], devy: [] } },
    }
    const calls = stubFetch(routes(r))
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Rookie Back')
    tapOn('Rookie Back')
    fireEvent.click(screen.getByRole('button', { name: 'Move to bench' }))
    await waitFor(() => expect(saves(calls)).toHaveLength(1))
    const sent = saves(calls)[0].roster
    expect(sent.taxi).toEqual([])
    expect(sent.bench.map((p) => p.id)).toEqual(['rb2', 'tx1'])
  })
})

