// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  applyLeagueGroup,
  groupLeagues,
  planLeagueGroupPatch,
  platformLabel,
  readLeagueGroup,
  withExistingSpelling,
  type GroupableLeague,
} from '@/lib/league-groups/leagueGroups'
import { LeagueGroupForm } from '@/components/league-groups/LeagueGroupPanel'
import { LeagueGroupsView } from '@/components/league-groups/LeagueGroupsView'

describe('LeagueGroupsView', () => {
  it('a failed read says so, and is not the empty state', () => {
    render(<LeagueGroupsView groups={null} />)
    expect(screen.getByTestId('league-groups-error')).toBeTruthy()
    expect(screen.queryByTestId('league-groups-empty')).toBeNull()
  })
  it('lists each group with its leagues, linked to the league', () => {
    render(
      <LeagueGroupsView
        groups={[{ key: 'k', name: 'Road To Glory', yours: true, leagues: [{ id: 'l1', name: 'RTG NCAAF', sport: 'NCAAF', platform: 'Fantrax', teams: 12, season: 2026, youCommission: true }] }]}
      />,
    )
    expect(screen.getByText('1 league · yours')).toBeTruthy()
    expect(screen.getByText('NCAAF · Fantrax · 12 teams · 2026')).toBeTruthy()
    expect(screen.getByText('RTG NCAAF').closest('a')?.getAttribute('href')).toBe('/league/l1')
  })
})

afterEach(cleanup)

const league = (over: Partial<GroupableLeague> & { id: string }): GroupableLeague => ({
  name: over.id,
  sport: 'NCAAF',
  platform: 'fantrax',
  leagueSize: 12,
  season: 2026,
  userId: 'comm',
  settings: {},
  ...over,
})
const tagged = (name: string, setBy = 'comm') => ({ league_group: { name, setBy } })

describe('readLeagueGroup', () => {
  it('reads a group, and anything malformed is no group', () => {
    expect(readLeagueGroup(tagged('  Road   To Glory '))).toEqual({ name: 'Road To Glory', setBy: 'comm' })
    expect(readLeagueGroup({ league_group: { name: 'X' } })).toBeNull()
    expect(readLeagueGroup({ league_group: 'X' })).toBeNull()
    expect(readLeagueGroup(null)).toBeNull()
  })
})

describe('planLeagueGroupPatch', () => {
  it('sets the group as the commissioner making the change, never as the body says', () => {
    expect(planLeagueGroupPatch({ name: 'Road To Glory', setBy: 'someone-else' }, 'comm')).toEqual({ ok: true, value: { name: 'Road To Glory', setBy: 'comm' } })
  })
  it('an empty or null name leaves the group; a missing or non-text name is refused', () => {
    expect(planLeagueGroupPatch({ name: '   ' }, 'comm')).toEqual({ ok: true, value: null })
    expect(planLeagueGroupPatch({ name: null }, 'comm')).toEqual({ ok: true, value: null })
    expect(planLeagueGroupPatch({}, 'comm')).toMatchObject({ ok: false, status: 400 })
    expect(planLeagueGroupPatch({ name: 7 }, 'comm')).toMatchObject({ ok: false })
    expect(planLeagueGroupPatch({ name: 'x'.repeat(41) }, 'comm')).toMatchObject({ ok: false })
  })
})

describe('withExistingSpelling', () => {
  it('a name matching an existing group keeps that group\'s spelling; a new name is kept as typed', () => {
    const typed = { name: 'af groups test', setBy: 'comm' }
    expect(withExistingSpelling(typed, ['AF Groups  Test', 'Other'])).toEqual({ name: 'AF Groups Test', setBy: 'comm' })
    expect(withExistingSpelling(typed, ['Other'])).toEqual(typed)
    expect(withExistingSpelling(null, ['Other'])).toBeNull()
  })
})

describe('platformLabel', () => {
  it('every native platform spelling reads AllFantasy', () => {
    for (const p of ['manual', 'MANUAL', 'allfantasy', 'native', '']) expect(platformLabel(p)).toBe('AllFantasy')
    expect(platformLabel('fantrax')).toBe('Fantrax')
  })
})

describe('applyLeagueGroup', () => {
  it('keeps every other setting, and leaving removes the key', () => {
    expect(applyLeagueGroup({ a: 1 }, { name: 'G', setBy: 'comm' })).toEqual({ a: 1, league_group: { name: 'G', setBy: 'comm' } })
    expect(applyLeagueGroup({ a: 1, ...tagged('G') }, null)).toEqual({ a: 1 })
  })
})

describe('groupLeagues', () => {
  it('puts one commissioner\'s same-named leagues together, whatever the case or spacing', () => {
    const groups = groupLeagues(
      [
        league({ id: 'rtg-ncaab', sport: 'NCAAB', settings: tagged('Road To Glory') }),
        league({ id: 'rtg-ncaaf', settings: tagged('road to glory ') }),
        league({ id: 'loose' }),
      ],
      'comm',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ name: 'Road To Glory', yours: true })
    expect(groups[0]!.leagues.map((l) => l.id)).toEqual(['rtg-ncaab', 'rtg-ncaaf'])
    expect(groups[0]!.leagues[0]).toMatchObject({ platform: 'Fantrax', teams: 12, youCommission: true })
  })
  it('two commissioners with the same group name are two groups', () => {
    const groups = groupLeagues(
      [league({ id: 'a', settings: tagged('Dynasty', 'c1') }), league({ id: 'b', userId: 'c2', settings: tagged('Dynasty', 'c2') })],
      'member',
    )
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => !g.yours && g.leagues.every((l) => !l.youCommission))).toBe(true)
  })
  it('the newest season\'s spelling names the group', () => {
    const groups = groupLeagues(
      [league({ id: 'old', season: 2025, settings: tagged('road to glory') }), league({ id: 'new', season: 2026, settings: tagged('Road To Glory') })],
      'comm',
    )
    expect(groups[0]!.name).toBe('Road To Glory')
  })
})

describe('LeagueGroupForm', () => {
  it('a commissioner saves a group name picked from their own', async () => {
    const onSave = vi.fn(async () => null)
    render(<LeagueGroupForm state={{ group: null, canEdit: true, suggestions: ['Road To Glory'] }} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Road To Glory' } })
    fireEvent.click(screen.getByText('Save group'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Road To Glory'))
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })
  it('leaving the group saves an empty name', async () => {
    const onSave = vi.fn(async () => null)
    render(<LeagueGroupForm state={{ group: { name: 'G' }, canEdit: true, suggestions: [] }} onSave={onSave} />)
    fireEvent.click(screen.getByText('Leave group'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(''))
  })
  it('a member sees the group and a link, and cannot edit; with no group they see nothing', () => {
    const { container, rerender } = render(<LeagueGroupForm state={{ group: { name: 'G' }, canEdit: false, suggestions: [] }} onSave={vi.fn()} />)
    expect(screen.queryByLabelText('Group name')).toBeNull()
    expect(screen.getByText('See every league in G').getAttribute('href')).toBe('/league-groups')
    rerender(<LeagueGroupForm state={{ group: null, canEdit: false, suggestions: [] }} onSave={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
  it('shows a refusal from the server', async () => {
    render(<LeagueGroupForm state={{ group: null, canEdit: true, suggestions: [] }} onSave={vi.fn(async () => 'Commissioner only')} />)
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByText('Save group'))
    expect(await screen.findByText('Commissioner only')).toBeTruthy()
  })
})
