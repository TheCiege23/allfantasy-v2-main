/**
 * The Guilly tab for an imported league: the view built from the provider's scores
 * (lib/guillotine/importedGuillyView.ts), its member-gated route
 * (app/api/leagues/[leagueId]/guillotine/imported), and the tab (app/league/[leagueId]/tabs/ImportedGuillyTab.tsx).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  session: { user: { id: 'u1' } } as { user: { id: string } } | null,
  member: true,
  league: {} as Record<string, unknown> | null,
  rows: [] as Array<{ week: number; rosterId: string; pointsFor: number; matchupId: number | null }>,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => h.member) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => h.league) },
    weeklyMatchup: { findMany: vi.fn(async () => h.rows) },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { externalId: '1', teamName: 'Axes', platformUserId: 'u1' },
        { externalId: '2', teamName: 'Blades', platformUserId: 'u2' },
        { externalId: '3', teamName: 'Cleavers', platformUserId: 'u3' },
        { externalId: '4', teamName: 'Daggers', platformUserId: 'u4' },
      ]),
    },
    roster: {
      findMany: vi.fn(async () => [
        { platformUserId: 'u1', playerData: { players: ['a'] } },
        { platformUserId: 'u2', playerData: { players: ['b'] } },
        { platformUserId: 'u3', playerData: { players: [] } },
        { platformUserId: 'u4', playerData: { players: [] } },
      ]),
    },
  },
}))

import { buildImportedGuillyView, guillyTabKind } from '@/lib/guillotine/importedGuillyView'
import { GET } from '@/app/api/leagues/[leagueId]/guillotine/imported/route'
import { ImportedGuillyTab } from '@/app/league/[leagueId]/tabs/ImportedGuillyTab'
import { NextRequest } from 'next/server'

const row = (week: number, rosterId: string, pointsFor: number) => ({ week, rosterId, pointsFor, matchupId: null })
const TEAMS = [{ rosterId: '1', name: 'Axes' }, { rosterId: '2', name: 'Blades' }, { rosterId: '3', name: 'Cleavers' }, { rosterId: '4', name: 'Daggers' }]
/** Daggers chopped after week 1, Cleavers after week 2; week 3 in play, Blades low. */
const ROWS = [
  row(1, '1', 110), row(1, '2', 100), row(1, '3', 90), row(1, '4', 80),
  row(2, '1', 105), row(2, '2', 95), row(2, '3', 70), row(2, '4', 0),
  row(3, '1', 50), row(3, '2', 40), row(3, '3', 0), row(3, '4', 0),
]

describe('the view (lib/guillotine/importedGuillyView.ts)', () => {
  it('this week’s scores among the teams alive, highest first, with the chop line marked; the chopped listed newest first', () => {
    const v = buildImportedGuillyView({ rows: ROWS, teams: TEAMS })
    expect(v.week).toBe(3)
    expect(v.standings).toEqual([
      { rosterId: '1', name: 'Axes', points: 50, onChopLine: false },
      { rosterId: '2', name: 'Blades', points: 40, onChopLine: true },
    ])
    expect(v.chopped).toEqual([{ rosterId: '3', name: 'Cleavers', week: 2 }, { rosterId: '4', name: 'Daggers', week: 1 }])
    expect(v.teamsAlive).toBe(2)
  })

  it('a tie at the bottom puts both on the chop line', () => {
    const v = buildImportedGuillyView({ rows: [row(1, '1', 90), row(1, '2', 70), row(1, '3', 70), row(1, '4', 80)], teams: TEAMS })
    expect(v.standings.filter((s) => s.onChopLine).map((s) => s.name)).toEqual(['Blades', 'Cleavers'])
  })

  it('before any score there is no week and no chop line', () => {
    const v = buildImportedGuillyView({ rows: [], teams: TEAMS })
    expect(v).toMatchObject({ week: null, teamsAlive: 4, scoredThisWeek: 0, chopped: [] })
    expect(v.standings.some((s) => s.onChopLine)).toBe(false)
  })
})

describe('which Guilly tab the league page shows (guillyTabKind)', () => {
  it('a native Guilly league gets the native tab; an imported one the imported tab; others none', () => {
    expect(guillyTabKind({ guillotineMode: true }, true)).toBe('native')
    expect(guillyTabKind({ leagueVariant: 'guillotine' }, true)).toBe('native')
    // Most imports carry only leagueType, which the native gate never read: they had no Guilly tab at all.
    expect(guillyTabKind({ leagueType: 'guillotine' }, false)).toBe('imported')
    expect(guillyTabKind({ leagueType: 'redraft', settings: { leagueTypeConfirmation: { type: 'guillotine' } } }, false)).toBe('imported')
    expect(guillyTabKind({ leagueType: 'redraft' }, false)).toBeNull()
    expect(guillyTabKind({ leagueType: 'redraft' }, true)).toBeNull()
  })

  it('an imported league still flagged guillotineMode never gets the native tab, which has no data for it', () => {
    expect(guillyTabKind({ guillotineMode: true, leagueType: 'redraft' }, false)).toBe('imported')
  })
})

describe('the route', () => {
  const get = () => GET(new NextRequest('https://allfantasy.test/api/leagues/L/guillotine/imported'), { params: Promise.resolve({ leagueId: 'L' }) })
  beforeEach(() => {
    h.session = { user: { id: 'u1' } }
    h.member = true
    h.rows = ROWS
    h.league = {
      id: 'L', platform: 'sleeper', platformLeagueId: 'SL9', season: 2026, leagueType: 'guillotine', guillotineMode: null,
      settings: { leagueTypeConfirmation: { type: 'guillotine' } }, status: 'in_season', lifecycleState: 'in_season', lastSyncedAt: new Date(),
    }
  })

  it('a member gets the provider’s standings, its name, and the check’s verdict', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ platform: 'sleeper', view: { week: 3, teamsAlive: 2 }, check: { status: 'ok', attention: 0, format: 'confirmed' } })
  })

  it('signed out 401, not a member 403', async () => {
    h.session = null
    expect((await get()).status).toBe(401)
    h.session = { user: { id: 'u1' } }
    h.member = false
    expect((await get()).status).toBe(403)
  })

  it('a native league, or an imported league that is not Guilly, gets 404', async () => {
    h.league = { ...h.league!, platform: 'allfantasy' }
    expect((await get()).status).toBe(404)
    h.league = { ...h.league!, platform: 'sleeper', leagueType: 'redraft', settings: {} }
    expect((await get()).status).toBe(404)
  })
})

describe('the tab', () => {
  const ready = (over: Record<string, unknown> = {}) => ({
    platform: 'sleeper',
    view: buildImportedGuillyView({ rows: ROWS, teams: TEAMS }),
    check: { status: 'ok', attention: 0, format: 'confirmed' },
    lastReadAt: null,
    ...over,
  })
  const mount = async (data: unknown, ok = true) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => data })))
    render(<ImportedGuillyTab leagueId="L" />)
    if (ok) await screen.findByTestId('imported-guilly-tab')
    else await screen.findByRole('alert')
  }

  it('labels the source, marks the chop line, and lists who is out', async () => {
    await mount(ready())
    expect(screen.getByTestId('imported-guilly-source').textContent).toBe('Results from Sleeper')
    expect(screen.getByTestId('imported-guilly-summary').textContent).toBe('2 teams alive · 2 chopped · week 3')
    expect(screen.getByTestId('imported-guilly-team-2').textContent).toContain('on the chop line')
    expect(screen.getByTestId('imported-guilly-team-1').textContent).not.toContain('on the chop line')
    expect(screen.getByTestId('imported-guilly-chopped').textContent).toContain('Daggers')
    expect(screen.queryByTestId('imported-guilly-doubt')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('when the check doubts the picture, it says so and links to the Sync screen', async () => {
    await mount(ready({ check: { status: 'attention', attention: 2, format: 'confirmed' } }))
    const doubt = screen.getByTestId('imported-guilly-doubt')
    expect(doubt.textContent).toContain('2 things need a look')
    expect(doubt.querySelector('a')?.getAttribute('href')).toBe('/core/sync?league=L')
    vi.unstubAllGlobals()
  })

  it('a guessed format asks for confirmation', async () => {
    await mount(ready({ check: { status: 'ok', attention: 0, format: 'detected' } }))
    expect(screen.getByTestId('imported-guilly-unconfirmed')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('a failed load says why', async () => {
    await mount({ error: 'Not an imported Guilly league' }, false)
    expect(screen.getByRole('alert').textContent).toBe('Not an imported Guilly league')
    expect(screen.queryByTestId('imported-guilly-tab')).toBeNull()
    vi.unstubAllGlobals()
  })
})
