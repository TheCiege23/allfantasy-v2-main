/**
 * Connected leagues (owner's page review #16, Phase C4): the resolver that finds a league's Survivor islands,
 * tournament round or Zombie universe, and the Commissioner Hub pop-up that shows it.
 *
 * The group-wide action (every draft at once) is offered only to the group's OWNER, because the routes it
 * calls (POST /api/tournament/draft, POST /api/zombie/universe/[id]/draft-schedule) refuse anyone else.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const db = vi.hoisted(() => ({
  exile: [] as Array<{ mainLeagueId: string; exileLeagueId: string }>,
  shellLeagues: [] as Array<{ tournamentId: string; roundId: string; leagueId: string | null; name: string; status: string; draftScheduledAt: Date | null }>,
  shells: [] as Array<{ id: string; name: string; commissionerId: string }>,
  rounds: [] as Array<{ id: string; roundNumber: number }>,
  legacyLeagues: [] as Array<{ tournamentId: string; leagueId: string }>,
  legacy: [] as Array<{ id: string; name: string; creatorId: string }>,
  zombieLeagues: [] as Array<{ leagueId: string; universeId: string | null; name: string | null; status: string; draftScheduledAt: Date | null; level: { name: string; rankOrder: number } | null }>,
  universes: [] as Array<{ id: string; name: string; commissionedByUserId: string | null; createdByUserId: string | null }>,
  leagues: [] as Array<{ id: string; name: string; status: string }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    survivorExileLeague: {
      findFirst: async ({ where }: { where: { OR: Array<{ mainLeagueId?: string; exileLeagueId?: string }> } }) =>
        db.exile.find((e) => where.OR.some((c) => (c.mainLeagueId && c.mainLeagueId === e.mainLeagueId) || (c.exileLeagueId && c.exileLeagueId === e.exileLeagueId))) ?? null,
    },
    tournamentLeague: {
      findUnique: async ({ where }: { where: { leagueId: string } }) => db.shellLeagues.find((l) => l.leagueId === where.leagueId) ?? null,
      findMany: async ({ where }: { where: { tournamentId: string; roundId: string } }) =>
        db.shellLeagues.filter((l) => l.tournamentId === where.tournamentId && l.roundId === where.roundId),
    },
    tournamentShell: { findUnique: async ({ where }: { where: { id: string } }) => db.shells.find((s) => s.id === where.id) ?? null },
    tournamentRound: { findUnique: async ({ where }: { where: { id: string } }) => db.rounds.find((r) => r.id === where.id) ?? null },
    legacyTournamentLeague: {
      findUnique: async ({ where }: { where: { leagueId: string } }) => db.legacyLeagues.find((l) => l.leagueId === where.leagueId) ?? null,
      findMany: async ({ where }: { where: { tournamentId: string } }) => db.legacyLeagues.filter((l) => l.tournamentId === where.tournamentId),
    },
    legacyTournament: { findUnique: async ({ where }: { where: { id: string } }) => db.legacy.find((t) => t.id === where.id) ?? null },
    zombieLeague: {
      findUnique: async ({ where }: { where: { leagueId: string } }) => db.zombieLeagues.find((l) => l.leagueId === where.leagueId) ?? null,
      findMany: async ({ where }: { where: { universeId: string } }) => db.zombieLeagues.filter((l) => l.universeId === where.universeId),
    },
    zombieUniverse: { findUnique: async ({ where }: { where: { id: string } }) => db.universes.find((u) => u.id === where.id) ?? null },
    league: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => db.leagues.filter((l) => where.id.in.includes(l.id)) },
  },
}))

import { readConnectedGroup, type ConnectedGroup } from '@/lib/league/connectedLeagues'
import { ConnectedLeaguesDialog, LeagueSettingsHubView, groupStatus, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { buildDraftGroups, buildGeneralGroups, buildNotificationGroups, buildTypeRuleGroups, buildWaiverGroups } from '@/lib/league-settings-hub/hubModel'
import { hubText } from '@/lib/league-settings-hub/hubI18n'

beforeEach(() => {
  for (const k of Object.keys(db) as Array<keyof typeof db>) (db[k] as unknown[]).length = 0
})
afterEach(cleanup)

describe('finding the group', () => {
  it('a league that stands alone has none', async () => {
    expect(await readConnectedGroup('solo', 'u1')).toBeNull()
  })

  it('Survivor: the same two islands from either side, current one marked', async () => {
    db.exile.push({ mainLeagueId: 'main', exileLeagueId: 'exile' })
    db.leagues.push({ id: 'main', name: 'Island', status: 'in_season' }, { id: 'exile', name: 'Island Exile', status: 'in_season' })
    const fromMain = await readConnectedGroup('main', 'u1')
    const fromExile = await readConnectedGroup('exile', 'u1')
    expect(fromMain?.kind).toBe('survivor')
    expect(fromMain?.leagues.map((l) => [l.role, l.current])).toEqual([['Main Island', true], ['Exile Island', false]])
    expect(fromExile?.leagues.map((l) => l.current)).toEqual([false, true])
    expect(fromExile?.hubHref).toBe('/survivor/main/commissioner')
    expect(fromMain?.draftSchedule).toBeNull()
  })

  it('a tournament shell lists this league’s round, and only its commissioner may schedule the drafts', async () => {
    db.shells.push({ id: 'T1', name: 'Fall Classic', commissionerId: 'boss' })
    db.rounds.push({ id: 'R1', roundNumber: 1 }, { id: 'R2', roundNumber: 2 })
    db.shellLeagues.push(
      { tournamentId: 'T1', roundId: 'R1', leagueId: 'a', name: 'Group A', status: 'forming', draftScheduledAt: null },
      { tournamentId: 'T1', roundId: 'R1', leagueId: null, name: 'Group B', status: 'forming', draftScheduledAt: null },
      { tournamentId: 'T1', roundId: 'R2', leagueId: 'z', name: 'Finals', status: 'setup', draftScheduledAt: null },
    )
    const boss = await readConnectedGroup('a', 'boss')
    expect(boss?.leagues.map((l) => l.name)).toEqual(['Group A', 'Group B'])
    expect(boss?.draftSchedule).toEqual({ kind: 'tournament', tournamentId: 'T1', roundNumber: 1 })
    const other = await readConnectedGroup('a', 'someone')
    expect(other?.isGroupOwner).toBe(false)
    expect(other?.draftSchedule).toBeNull()
  })

  it('a legacy tournament lists its leagues; drafts stay on its own console', async () => {
    db.legacy.push({ id: 'L1', name: 'Old Cup', creatorId: 'boss' })
    db.legacyLeagues.push({ tournamentId: 'L1', leagueId: 'b' }, { tournamentId: 'L1', leagueId: 'a' })
    db.leagues.push({ id: 'a', name: 'Alpha', status: 'active' }, { id: 'b', name: 'Bravo', status: 'active' })
    const g = await readConnectedGroup('a', 'boss')
    expect(g?.leagues.map((l) => l.name)).toEqual(['Alpha', 'Bravo'])
    expect(g?.isGroupOwner).toBe(true)
    expect(g?.draftSchedule).toBeNull()
  })

  it('a Zombie universe, top level first; the owner is commissionedBy, else createdBy', async () => {
    db.universes.push({ id: 'U1', name: 'Outbreak', commissionedByUserId: null, createdByUserId: 'boss' })
    db.zombieLeagues.push(
      { leagueId: 'b1', universeId: 'U1', name: 'Beta One', status: 'setup', draftScheduledAt: null, level: { name: 'Beta', rankOrder: 2 } },
      { leagueId: 'a1', universeId: 'U1', name: null, status: 'in_season', draftScheduledAt: new Date('2026-11-29T00:00:00Z'), level: { name: 'Alpha', rankOrder: 1 } },
    )
    db.leagues.push({ id: 'a1', name: 'Alpha One', status: 'in_season' })
    const g = await readConnectedGroup('b1', 'boss')
    expect(g?.leagues.map((l) => [l.name, l.role])).toEqual([['Alpha One', 'Alpha'], ['Beta One', 'Beta']])
    expect(g?.leagues[0]?.draftAt).toBe('2026-11-29T00:00:00.000Z')
    expect(g?.draftSchedule).toEqual({ kind: 'zombie', universeId: 'U1' })
    expect((await readConnectedGroup('b1', 'someone'))?.draftSchedule).toBeNull()
  })
})

const zombie: ConnectedGroup = {
  kind: 'zombie', name: 'Outbreak', hubHref: '/zombie/universe/U1', isGroupOwner: true, draftSchedule: { kind: 'zombie', universeId: 'U1' },
  leagues: [
    { leagueId: 'L1', name: 'Kingdom North', role: 'Gamma', status: 'in_season', draftAt: null, current: true },
    { leagueId: 'L2', name: 'Outbreak South', role: 'Gamma', status: 'setup', draftAt: null, current: false },
  ],
}

function cb(over: Partial<HubCallbacks> = {}): HubCallbacks {
  return {
    onToggleSetting: vi.fn(), onSaveTeamName: vi.fn(async () => null), onSaveNote: vi.fn(async () => null),
    onToggleNotification: vi.fn(), onToggleLeagueNotifications: vi.fn(), onToggleCoCommissioner: vi.fn(),
    onInviteCoOwner: vi.fn(async () => null), onOpenEditor: vi.fn(), onCopy: vi.fn(), ...over,
  }
}

describe('the pop-up', () => {
  it('lists every league, marks this one, links the others and the group’s hub', () => {
    render(<ConnectedLeaguesDialog group={zombie} cb={cb()} onClose={() => {}} />)
    const rows = screen.getAllByTestId('connected-league')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('This league')).toBeTruthy()
    expect(within(rows[0]!).queryByRole('link')).toBeNull()
    expect(within(rows[1]!).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/league/L2')
    expect(within(rows[1]!).getByText('Gamma · Setting up')).toBeTruthy()
    expect(screen.getByTestId('connected-hub-link').getAttribute('href')).toBe('/zombie/universe/U1')
  })

  it('schedules every draft at once through the callback, and shows what came back', async () => {
    const schedule = vi.fn(async () => null)
    render(<ConnectedLeaguesDialog group={zombie} cb={cb({ onScheduleConnectedDrafts: schedule })} onClose={() => {}} />)
    const save = screen.getByTestId('connected-schedule-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('connected-schedule-when'), { target: { value: '2026-11-29T20:00' } })
    fireEvent.click(save)
    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(1))
    expect(schedule.mock.calls[0]![0]).toBe(new Date('2026-11-29T20:00').toISOString())
    expect((await screen.findByRole('status')).textContent).toBe('Every draft is set for that time.')
  })

  it('a refusal is shown as it comes back', async () => {
    render(<ConnectedLeaguesDialog group={zombie} cb={cb({ onScheduleConnectedDrafts: async () => 'Commissioner only' })} onClose={() => {}} />)
    fireEvent.change(screen.getByTestId('connected-schedule-when'), { target: { value: '2026-11-29T20:00' } })
    fireEvent.click(screen.getByTestId('connected-schedule-save'))
    expect((await screen.findByRole('alert')).textContent).toBe('Commissioner only')
  })

  it('a commissioner who does not own the group is told who can schedule, and gets no control', () => {
    render(<ConnectedLeaguesDialog group={{ ...zombie, isGroupOwner: false, draftSchedule: null }} cb={cb()} onClose={() => {}} />)
    expect(screen.queryByTestId('connected-schedule')).toBeNull()
    expect(screen.getByTestId('connected-owner-only').textContent).toBe('Only the universe’s commissioner can schedule every draft at once.')
  })

  it('Escape and the backdrop close it; a click inside does not', () => {
    const onClose = vi.fn()
    render(<ConnectedLeaguesDialog group={zombie} cb={cb()} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('connected-leagues-dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('connected-leagues-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('in the Commissioner Hub', () => {
  function data(connected: ConnectedGroup | null): HubViewData {
    const p = { league: { teamCount: 12, playoffTeams: 6 }, settings: {}, settingsSnapshot: {} }
    return {
      leagueId: 'L1', kind: 'zombie', leagueName: 'Kingdom North', leagueAvatarUrl: null, sport: 'NFL', season: 2026, teamCount: 12, leagueArt: null,
      canEdit: true, isHeadCommissioner: true, importedFrom: null, myTeam: null,
      notifications: { groups: buildNotificationGroups('zombie', true), on: {}, leagueEnabled: true },
      general: buildGeneralGroups(p, 'zombie'), waivers: buildWaiverGroups(p, 'zombie'), typeRules: buildTypeRuleGroups(p, 'zombie'),
      commissionerNote: null, roster: [], scoring: null, draft: buildDraftGroups(p), draftOrder: [],
      members: [], coOwners: null, invite: null, draftHistory: null, seasons: [], standings: [], highScores: [],
      playerHighScores: null, correctionWeeks: null, commissionerTasks: { cards: [], overflow: [] }, afOptions: [], connected,
    }
  }

  it('a connected league shows the banner first, and it opens the pop-up', () => {
    render(<LeagueSettingsHubView data={data(zombie)} cb={cb()} initialTab="hub" />)
    expect(screen.getByRole('navigation', { name: 'On this page' }).textContent).toMatch(/^On this pageConnected leaguesNeeds you/)
    expect(screen.getByText('Outbreak · 2 leagues')).toBeTruthy()
    fireEvent.click(screen.getByTestId('connected-open'))
    expect(screen.getByTestId('connected-leagues-dialog')).toBeTruthy()
  })

  it('a league that stands alone shows no banner', () => {
    render(<LeagueSettingsHubView data={data(null)} cb={cb()} initialTab="hub" />)
    expect(screen.queryByTestId('connected-open')).toBeNull()
  })
})

describe('Spanish', () => {
  it('every label the pop-up can show translates', () => {
    const strings = [
      'Connected leagues', 'Open connected leagues', 'This league', 'Schedule every draft at once', 'Draft time', 'Set every draft',
      'Every draft is set for that time.', 'Main Island', 'Exile Island', 'Round 2', '3 leagues', '1 league',
      'Main Island and Exile Island share one season.', 'This league is one of a tournament’s leagues.', 'This league is one of a Zombie universe’s leagues.',
      'Open the Survivor commissioner page', 'Open the tournament hub', 'Open the universe hub',
      'Only the tournament’s commissioner can schedule every draft at once.', 'Only the universe’s commissioner can schedule every draft at once.',
      'Every league above drafts at the same time. You can still change one league’s draft from that league.',
      ...['setup', 'forming', 'drafting', 'in_season', 'complete', 'archived'].map((s) => groupStatus(s)!),
    ]
    expect(strings.filter((s) => hubText('es', s) === s)).toEqual([])
  })
})
