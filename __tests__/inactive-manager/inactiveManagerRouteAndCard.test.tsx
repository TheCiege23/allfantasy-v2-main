import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const m = vi.hoisted(() => ({ session: vi.fn(), elevated: vi.fn(), view: vi.fn(), set: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ readInactiveManagerView: m.view, setInactiveManagerMode: m.set }))

import { GET, POST } from '@/app/api/leagues/[leagueId]/inactive-managers/handler'
import { InactiveManagerCommissioner } from '@/components/core-app/InactiveManagerCommissioner'
import { describeLogEntry } from '@/lib/league-log/leagueLog'

const ctx = { params: { leagueId: 'L' } }
const url = 'http://x/api/leagues/L/inactive-managers'

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'commish' } })
  m.elevated.mockResolvedValue(true)
  m.view.mockResolvedValue({ native: true, teams: [] })
  m.set.mockResolvedValue({ ok: true, managed: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('GET / POST /api/leagues/:id/inactive-managers', () => {
  it('is for commissioners and co-commissioners only', async () => {
    m.session.mockResolvedValueOnce(null)
    expect((await GET(new NextRequest(url), ctx)).status).toBe(401)
    m.elevated.mockResolvedValueOnce(false)
    expect((await GET(new NextRequest(url), ctx)).status).toBe(403)
    expect(m.view).not.toHaveBeenCalled()
    expect((await GET(new NextRequest(url), ctx)).status).toBe(200)
  })

  it('passes the team and the switch through, and answers a refusal with its status', async () => {
    const res = await POST(new NextRequest(url, { method: 'POST', body: JSON.stringify({ rosterId: 'r1', on: true }) }), ctx)
    expect(res.status).toBe(200)
    expect(m.set).toHaveBeenCalledWith('L', 'commish', 'r1', true)
    m.set.mockResolvedValueOnce({ ok: false, status: 409, error: 'AllFantasy can only set lineups in leagues it runs.' })
    const refused = await POST(new NextRequest(url, { method: 'POST', body: JSON.stringify({ rosterId: 'r1', on: true }) }), ctx)
    expect(refused.status).toBe(409)
  })
})

describe('the league log says who is setting a lineup', () => {
  const row = (actionType: string) => ({ id: 'a', actionType, entityId: 'r1', userId: null, beforeState: null, afterState: null, metadata: { rosterId: 'r1' }, createdAt: new Date() })
  const opts = { lang: 'en' as const, names: { users: {}, teams: { r1: 'Taco Tuesday' } }, forCommissioner: false }
  it('to the whole league, naming the team', () => {
    expect(describeLogEntry(row('inactive_manager_mode.on'), opts)?.title).toBe("AllFantasy now sets Taco Tuesday's best lineup each week while the manager is away")
    expect(describeLogEntry(row('inactive_manager_mode.ended'), opts)?.title).toBe("Taco Tuesday's manager is back and set their own lineup, so AllFantasy stopped")
    expect(describeLogEntry(row('inactive_manager_mode.off'), { ...opts, lang: 'es' })?.title).toBe('AllFantasy dejó de poner la alineación de Taco Tuesday')
  })
})

describe('the commissioner card', () => {
  const team = (over: Record<string, unknown>) => ({ rosterId: 'r1', teamName: 'Taco Tuesday', managerName: 'sam', status: 'inactive', managed: null, suggested: true, ...over })

  it('shows suggested teams first and turns one on', async () => {
    let managed = false
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') { managed = true; return { ok: true, json: async () => ({ managed: true }) } }
      return { ok: true, json: async () => ({ native: true, teams: [managed ? team({ managed: { since: '2026-10-25T00:00:00Z', byUserId: 'c' }, suggested: false }) : team({}), team({ rosterId: 'r2', teamName: 'Other', status: 'active', suggested: false })] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<InactiveManagerCommissioner leagueId="L" />)
    await screen.findByText(/Suggested: no activity/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Let AllFantasy set lineups' })[0])
    await screen.findByText('On. AllFantasy will set this lineup within the hour.')
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ rosterId: 'r1', on: true })
    await screen.findByRole('button', { name: 'Stop' })
  })

  it('shows the weekly Chimmy reports, line by line, and nothing when there are none', async () => {
    const body = { native: true, autopilotEntitled: true, chimmyLimit: 4, teams: [team({ suggested: false, managed: { since: 's', byUserId: 'c', autopilot: { style: 'win_now', since: 's' } } })],
      chimmyReports: [{ title: "Chimmy's week 6", body: 'Here is what Chimmy did for its team in week 6.\nTaco Tuesday (Chimmy): still in the game, voted at Tribal Council.', sentAt: '2026-10-20T12:00:00.000Z' }] }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })))
    render(<InactiveManagerCommissioner leagueId="L" />)
    await screen.findByText('Chimmy’s weekly reports')
    expect(screen.getByText("Chimmy's week 6")).toBeTruthy()
    expect(screen.getByText('Taco Tuesday (Chimmy): still in the game, voted at Tribal Council.')).toBeTruthy()
    cleanup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...body, chimmyReports: [] }) })))
    const { container } = render(<InactiveManagerCommissioner leagueId="L" />)
    await screen.findByTestId('chimmy-managers')
    expect(container.querySelector('[data-testid="chimmy-reports"]')).toBeNull()
  })

  it('without AF Commissioner, offers one free Chimmy team and the upgrade, and locks the rest once it is used', async () => {
    const free = { rosterId: 'r1', teamName: 'Taco Tuesday', managerName: 'sam', status: 'inactive', suggested: false, managed: null, emptySeat: true }
    const other = { ...free, rosterId: 'r2', teamName: 'Other' }
    const body = (running: boolean) => ({ native: true, autopilotEntitled: false, chimmyLimit: 4, chimmyFreeTeams: 1, chimmyReports: [],
      teams: [running ? { ...free, managed: { since: 's', byUserId: 'c', autopilot: { style: 'win_now', since: 's' } } } : free, other] })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body(false) })))
    render(<InactiveManagerCommissioner leagueId="L" />)
    await screen.findByText('Chimmy runs 0 of 1 free team')
    expect(screen.getByTestId('chimmy-free-upsell').textContent).toBe('Let Chimmy run up to 4 teams (AF Commissioner)')
    const selects = () => screen.getAllByTestId('chimmy-manager-team').map((li) => li.querySelector('select') as HTMLSelectElement)
    expect(selects().map((x) => x.disabled)).toEqual([false, false])
    cleanup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body(true) })))
    render(<InactiveManagerCommissioner leagueId="L" />)
    await screen.findByText('Chimmy runs 1 of 1 free team')
    expect(screen.getByTestId('chimmy-manager-limit').textContent).toBe('Your free Chimmy team is in use. AF Commissioner lets Chimmy run up to 4 teams.')
    // The free team can still change style or be switched off; the other is locked.
    expect(selects().map((x) => x.disabled)).toEqual([false, true])
  })

  it('renders nothing for an imported league', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ native: false, teams: [] }) })))
    const { container } = render(<InactiveManagerCommissioner leagueId="L" />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('[data-testid="inactive-manager-mode"]')).toBeNull()
  })
})
