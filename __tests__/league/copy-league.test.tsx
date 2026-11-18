/**
 * Copy leagues, part 1 — who is which real team (docs/league-page/COPY_LEAGUES_DESIGN.md; owner decisions
 * 2026-11-18: NFL only, any size, managers pick, the real name replaces theirs and comes back when let go).
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const db = vi.hoisted(() => ({
  league: { id: 'L1', sport: 'NFL', platform: 'manual', settings: {} as Record<string, unknown> } as null | { id: string; sport: string; platform: string; settings: Record<string, unknown> },
  teams: [] as Array<{ id: string; externalId: string; teamName: string; avatarUrl: string | null; ownerName: string; claimedByUserId: string | null }>,
  draftStatus: 'pre_draft' as string | null,
  commissioners: new Set<string>(['boss']),
  rosterWrites: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
}))

vi.mock('@/lib/prisma', () => {
  const league = {
    findUnique: async () => (db.league ? { ...db.league } : null),
    update: async ({ data }: { data: { settings: Record<string, unknown> } }) => {
      if (db.league) db.league.settings = data.settings
      return {}
    },
  }
  const leagueTeam = {
    findMany: async () => db.teams.map((t) => ({ ...t })),
    update: async ({ where, data }: { where: { id: string }; data: { teamName: string; avatarUrl: string | null } }) => {
      const t = db.teams.find((x) => x.id === where.id)!
      Object.assign(t, data)
      return t
    },
  }
  const redraftRoster = { updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { db.rosterWrites.push(args); return { count: 1 } } }
  const tx = { league, leagueTeam, redraftRoster }
  return {
    prisma: {
      league,
      leagueTeam,
      redraftRoster,
      draftSession: { findFirst: async () => (db.draftStatus ? { status: db.draftStatus } : null) },
      redraftSeason: { findFirst: async () => ({ id: 'S1' }) },
      roster: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, redraftRosterId: `rr-${id}` })) },
      $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  }
})
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: async (_l: string, u: string) => db.commissioners.has(u) }))
vi.mock('@/server/services/auditService', () => ({ logAction: async () => ({}) }))

import {
  changeCopyTeam,
  copyLeagueTeams,
  disableCopyLeague,
  readCopyLeague,
  withCopyLeague,
  type CopyLeagueState,
} from '@/lib/league/copyLeague'
import { changeCopyLeague, readCopyLeagueForViewer } from '@/lib/league/copyLeagueService'
import { CopyLeaguePanel } from '@/components/league-settings/CopyLeaguePanel'
import { afOptionsSummary } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { buildAfOptions } from '@/lib/league-settings-hub/hubModel'
import { hubText } from '@/lib/league-settings-hub/hubI18n'

const on = (teams: Record<string, string> = {}, previous: CopyLeagueState['previous'] = {}): CopyLeagueState => ({ enabled: true, sport: 'NFL', teams, previous })
const rows = [
  { id: 't1', teamName: 'Ghost Protocol', avatarUrl: 'https://img/ghost.png' },
  { id: 't2', teamName: 'Taco Tuesday', avatarUrl: null },
]

describe('the real teams', () => {
  it('NFL has all 32, by name, each with a crest; other sports wait for a verified table', () => {
    const nfl = copyLeagueTeams('NFL')
    expect(nfl).toHaveLength(32)
    expect(nfl[0]!.name).toBe('Arizona Cardinals')
    expect(nfl.find((t) => t.code === 'BUF')).toMatchObject({ name: 'Buffalo Bills' })
    expect(nfl.every((t) => typeof t.logo === 'string' && t.logo.startsWith('https://'))).toBe(true)
    expect(copyLeagueTeams('NBA')).toEqual([])
    expect(copyLeagueTeams(null)).toEqual([])
  })

  it('reads back what it wrote, drops unknown codes, and is never on outside the NFL', () => {
    const s = withCopyLeague({ other: 1 }, on({ t1: 'BUF', t2: 'XYZ' }, { t1: { teamName: 'Ghost', avatarUrl: null } }))
    expect(s.other).toBe(1)
    expect(readCopyLeague(s, 'NFL')).toEqual({ enabled: true, sport: 'NFL', teams: { t1: 'BUF' }, previous: { t1: { teamName: 'Ghost', avatarUrl: null } } })
    expect(readCopyLeague(s, 'NBA').enabled).toBe(false)
  })
})

describe('taking, swapping and letting go', () => {
  it('taking a team writes its name and crest, and keeps the manager’s own', () => {
    const r = changeCopyTeam({ state: on(), teams: rows, leagueTeamId: 't1', code: 'BUF', swap: false })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.teams).toEqual({ t1: 'BUF' })
    expect(r.state.previous.t1).toEqual({ teamName: 'Ghost Protocol', avatarUrl: 'https://img/ghost.png' })
    expect(r.writes).toEqual([{ leagueTeamId: 't1', teamName: 'Buffalo Bills', avatarUrl: expect.stringContaining('https://') }])
  })

  it('switching teams keeps the ORIGINAL own name; letting go restores it', () => {
    const first = changeCopyTeam({ state: on(), teams: rows, leagueTeamId: 't1', code: 'BUF', swap: false })
    if (!first.ok) throw new Error('first')
    const asBills = [{ id: 't1', teamName: 'Buffalo Bills', avatarUrl: 'x' }, rows[1]!]
    const second = changeCopyTeam({ state: first.state, teams: asBills, leagueTeamId: 't1', code: 'MIA', swap: false })
    if (!second.ok) throw new Error('second')
    expect(second.state.previous.t1?.teamName).toBe('Ghost Protocol')
    const back = changeCopyTeam({ state: second.state, teams: asBills, leagueTeamId: 't1', code: null, swap: false })
    expect(back.ok && back.writes).toEqual([{ leagueTeamId: 't1', teamName: 'Ghost Protocol', avatarUrl: 'https://img/ghost.png' }])
    expect(back.ok && back.state.teams).toEqual({})
  })

  it('a manager cannot take a team someone has; the commissioner swaps them', () => {
    const state = on({ t1: 'BUF', t2: 'MIA' }, { t1: { teamName: 'Ghost Protocol', avatarUrl: null }, t2: { teamName: 'Taco Tuesday', avatarUrl: null } })
    expect(changeCopyTeam({ state, teams: rows, leagueTeamId: 't2', code: 'BUF', swap: false })).toMatchObject({ ok: false, code: 'TAKEN' })
    const swap = changeCopyTeam({ state, teams: rows, leagueTeamId: 't2', code: 'BUF', swap: true })
    expect(swap.ok && swap.state.teams).toEqual({ t1: 'MIA', t2: 'BUF' })
    expect(swap.ok && swap.writes.map((w) => [w.leagueTeamId, w.teamName])).toEqual([['t1', 'Miami Dolphins'], ['t2', 'Buffalo Bills']])
  })

  it('a commissioner taking a held team for a team with none gives the holder its own name back', () => {
    const state = on({ t1: 'BUF' }, { t1: { teamName: 'Ghost Protocol', avatarUrl: null } })
    const r = changeCopyTeam({ state, teams: rows, leagueTeamId: 't2', code: 'BUF', swap: true })
    expect(r.ok && r.state.teams).toEqual({ t2: 'BUF' })
    expect(r.ok && r.writes[0]).toEqual({ leagueTeamId: 't1', teamName: 'Ghost Protocol', avatarUrl: null })
  })

  it('refuses when off, an unknown code, or a team not in the league; turning it off restores everyone', () => {
    expect(changeCopyTeam({ state: { ...on(), enabled: false }, teams: rows, leagueTeamId: 't1', code: 'BUF', swap: false })).toMatchObject({ ok: false, code: 'NOT_ENABLED' })
    expect(changeCopyTeam({ state: on(), teams: rows, leagueTeamId: 't1', code: 'LAL', swap: false })).toMatchObject({ ok: false, code: 'UNKNOWN_TEAM' })
    expect(changeCopyTeam({ state: on(), teams: rows, leagueTeamId: 'zz', code: 'BUF', swap: false })).toMatchObject({ ok: false, code: 'NO_SUCH_LEAGUE_TEAM' })
    const off = disableCopyLeague(on({ t1: 'BUF' }, { t1: { teamName: 'Ghost Protocol', avatarUrl: null } }))
    expect(off.state).toEqual({ enabled: false, sport: 'NFL', teams: {}, previous: {} })
    expect(off.writes).toEqual([{ leagueTeamId: 't1', teamName: 'Ghost Protocol', avatarUrl: null }])
  })
})

describe('the service', () => {
  beforeEach(() => {
    db.league = { id: 'L1', sport: 'NFL', platform: 'manual', settings: { copy_league: { enabled: true } } }
    db.teams = [
      { id: 't1', externalId: 'r1', teamName: 'Ghost Protocol', avatarUrl: null, ownerName: 'Ana', claimedByUserId: 'ana' },
      { id: 't2', externalId: 'r2', teamName: 'Taco Tuesday', avatarUrl: null, ownerName: 'Ben', claimedByUserId: 'ben' },
    ]
    db.draftStatus = 'pre_draft'
    db.rosterWrites = []
  })

  it('a manager takes a team for the team they claimed; the current season roster is renamed too', async () => {
    expect(await changeCopyLeague('L1', 'ana', { action: 'pick', code: 'BUF' })).toEqual({ ok: true })
    expect(db.teams[0]!.teamName).toBe('Buffalo Bills')
    expect(db.rosterWrites).toEqual([{ where: { id: 'rr-r1', leagueId: 'L1', seasonId: 'S1' }, data: { teamName: 'Buffalo Bills', avatarUrl: expect.any(String) } }])
    const v = await readCopyLeagueForViewer('L1', 'ben')
    expect(v?.teams.find((t) => t.leagueTeamId === 't1')?.code).toBe('BUF')
    expect(v?.myLeagueTeamId).toBe('t2')
    expect(await changeCopyLeague('L1', 'ben', { action: 'pick', code: 'BUF' })).toMatchObject({ ok: false, code: 'TAKEN', status: 409 })
  })

  it('locks managers once the draft starts; the commissioner can still assign', async () => {
    db.draftStatus = 'in_progress'
    expect(await changeCopyLeague('L1', 'ana', { action: 'pick', code: 'BUF' })).toMatchObject({ ok: false, code: 'LOCKED' })
    expect(await changeCopyLeague('L1', 'boss', { action: 'assign', leagueTeamId: 't1', code: 'BUF' })).toEqual({ ok: true })
    expect((await readCopyLeagueForViewer('L1', 'ana'))?.locked).toBe(true)
  })

  it('only the commissioner turns it on or off, or assigns; an imported league and a non-NFL league are refused', async () => {
    expect(await changeCopyLeague('L1', 'ana', { action: 'disable' })).toMatchObject({ ok: false, code: 'COMMISSIONER_ONLY' })
    expect(await changeCopyLeague('L1', 'ana', { action: 'assign', leagueTeamId: 't2', code: 'BUF' })).toMatchObject({ ok: false, code: 'COMMISSIONER_ONLY' })
    db.league!.platform = 'sleeper'
    expect(await changeCopyLeague('L1', 'boss', { action: 'enable' })).toMatchObject({ ok: false, code: 'IMPORTED_LEAGUE' })
    db.league!.platform = 'manual'
    db.league!.sport = 'NBA'
    expect(await changeCopyLeague('L1', 'boss', { action: 'enable' })).toMatchObject({ ok: false, code: 'SPORT_UNSUPPORTED' })
    expect((await readCopyLeagueForViewer('L1', 'boss'))?.available).toBe(false)
  })

  it('a manager with no team cannot take one', async () => {
    expect(await changeCopyLeague('L1', 'stranger', { action: 'pick', code: 'BUF' })).toMatchObject({ ok: false, code: 'NO_TEAM' })
  })
})

describe('where it shows', () => {
  it('the AllFantasy options list it for NFL leagues, with how many teams have a real team', () => {
    expect(afOptionsSummary('redraft', 12, 'NFL')).toBe('Copy league')
    expect(afOptionsSummary('keeper', 12, 'NFL')).toBe('Copy league · Keeper rules')
    expect(afOptionsSummary('redraft', 12, 'NBA')).toBeNull()
    const row = buildAfOptions({ league: { sport: 'NFL', teamCount: 12 }, settingsSnapshot: { copy_league: { enabled: true, teams: { a: 'BUF', b: 'MIA' } } } }, 'redraft', 'L1')
      .find((o) => o.key === 'copyLeague')
    expect(row).toMatchObject({ value: '2 of 12 teams have a real team', panel: 'af-options' })
    expect(hubText('es', row!.value)).toBe('2 de 12 equipos tienen un equipo real')
    expect(hubText('es', row!.description)).not.toBe(row!.description)
  })
})

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const view = (over: Record<string, unknown> = {}) => ({
  available: true, enabled: true, locked: false, canManage: false, myLeagueTeamId: 't1',
  teams: [
    { leagueTeamId: 't1', teamName: 'Ghost Protocol', ownerName: 'Ana', code: null },
    { leagueTeamId: 't2', teamName: 'Buffalo Bills', ownerName: 'Ben', code: 'BUF' },
  ],
  catalog: copyLeagueTeams('NFL'),
  ...over,
})

describe('the panel', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(cleanup)

  it('a manager sees the teams, can’t pick a taken one, and picks', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, view())).mockResolvedValueOnce(reply(200, { ok: true, view: view() }))
    render(<CopyLeaguePanel leagueId="L1" mode="mine" />)
    const select = (await screen.findByTestId('copy-league-pick')) as HTMLSelectElement
    const bills = [...select.options].find((o) => o.value === 'BUF')!
    expect(bills.disabled).toBe(true)
    expect(bills.textContent).toBe('Buffalo Bills (taken by Ben)')
    fireEvent.change(select, { target: { value: 'MIA' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ action: 'pick', code: 'MIA' })
  })

  it('shows nothing while copy league is off, and says so once teams are locked', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, view({ enabled: false })))
    const { container } = render(<CopyLeaguePanel leagueId="L1" mode="mine" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    cleanup()
    fetchMock.mockResolvedValueOnce(reply(200, view({ locked: true })))
    render(<CopyLeaguePanel leagueId="L1" mode="mine" />)
    expect(await screen.findByTestId('copy-league-locked')).toBeTruthy()
    expect((screen.getByTestId('copy-league-pick') as HTMLSelectElement).disabled).toBe(true)
  })

  it('the commissioner turns it on and assigns, swapping a taken team', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, view({ canManage: true })))
      .mockResolvedValueOnce(reply(200, { ok: true, view: view({ canManage: true }) }))
    render(<CopyLeaguePanel leagueId="L1" mode="commissioner" />)
    expect((await screen.findByTestId('copy-league-count')).textContent).toBe('1 of 2 teams have a real team.')
    const [first] = screen.getAllByTestId('copy-league-row')
    const select = within(first!).getByRole('combobox') as HTMLSelectElement
    expect([...select.options].find((o) => o.value === 'BUF')!.disabled).toBe(false)
    fireEvent.change(select, { target: { value: 'BUF' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ action: 'assign', leagueTeamId: 't1', code: 'BUF' })
  })

  it('a manager who is not a commissioner gets no commissioner panel', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, view({ canManage: false })))
    const { container } = render(<CopyLeaguePanel leagueId="L1" mode="commissioner" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
