// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamSettingsPanel } from '@/app/league/[leagueId]/components/settings/TeamSettingsPanel'
import { buildTeamDirectoryCsv, type TeamDirectoryRow } from '@/lib/league/teamDirectoryExport'

vi.mock('@/components/league-settings/DivisionSettingsCommissionerPanel', () => ({
  DivisionSettingsCommissionerPanel: () => <p>Division editor</p>,
}))
vi.mock('@/components/core-app/LeagueInvitePanel', () => ({ LeagueInvitePanel: () => <p>Share league link</p> }))
vi.mock('@/app/league/[leagueId]/components/settings/TeamCoOwnerPanel', () => ({ TeamCoOwnerPanel: () => <p>Co-owner editor</p> }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const manager = { id: 'private-id', username: 'private-username', name: 'Manager' }
function makeTeam(n: number, extra: Partial<TeamDirectoryRow> = {}): TeamDirectoryRow {
  return {
    id: 'team-' + n, externalId: 'external-' + n, name: 'Franchise ' + n, division: n > 125 ? 'West' : 'East',
    abbreviation: '', status: 'open', manager: null, avatarUrl: null, role: null, rosterId: 'roster-' + n, coOwners: [],
    ...extra,
  }
}

describe('commissioner team settings', () => {
  it('filters 250 seats, assigns a second team, and uses the native settings route contract', async () => {
    const directory = {
      native: true, canManage: true, isHeadCommissioner: true, capacity: 250, leagueName: 'Commissioner QA',
      multiTeamSupported: true, allowMultiTeamManagers: true, allowManagerTeamNameEdits: true,
      teams: [makeTeam(1, { status: 'managed', manager }), ...Array.from({ length: 249 }, (_, i) => makeTeam(i + 2))],
    }
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' && url.endsWith('/managers')) directory.teams[249] = makeTeam(250, { status: 'managed', manager })
      return { ok: true, json: async () => ({ directory }) }
    })
    vi.stubGlobal('fetch', fetcher)
    render(<TeamSettingsPanel leagueId="league" canEdit />)
    expect((await screen.findAllByRole('listitem')).length).toBe(250)
    fireEvent.change(screen.getByRole('combobox', { name: 'Division' }), { target: { value: 'West' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(125)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Franchise 250' } })
    const team = screen.getByRole('listitem')
    fireEvent.click(within(team).getByRole('button', { name: 'Manage Franchise 250' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'AllFantasy username' }), { target: { value: 'private-username' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign manager' }))
    await screen.findByText(/2 teams/)
    expect(fetcher).toHaveBeenCalledWith('/api/commissioner/leagues/league/managers', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ rosterId: 'roster-250', username: 'private-username' }),
    }))

    fireEvent.click(screen.getByText('Capacity and manager rules'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow managers to edit team names and abbreviations' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save team rules' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/leagues/league/settings', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ section: 'general', updates: { allowManagerTeamNameEdits: false } }),
    })))
  })

  it('deduplicates an invite batch and reports its partial outcome', async () => {
    const directory = {
      native: true, canManage: true, isHeadCommissioner: true, capacity: 4, leagueName: 'Commissioner QA',
      multiTeamSupported: true, allowMultiTeamManagers: true, allowManagerTeamNameEdits: true, teams: [makeTeam(1)],
    }
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return { ok: true, json: async () => ({ directory }) }
      const { email } = JSON.parse(String(init.body))
      const sent = email === 'one@example.test'
      return { ok: sent, status: sent ? 200 : 429, json: async () => ({ sent, inviteUrl: '/join?code=TEST' }) }
    })
    vi.stubGlobal('fetch', fetcher)
    render(<TeamSettingsPanel leagueId="league" canEdit />)
    fireEvent.click(await screen.findByRole('button', { name: 'Invite managers' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Email addresses' }), {
      target: { value: 'one@example.test, ONE@example.test, two@example.test' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Personal note' }), { target: { value: 'Welcome to the league.' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Send invites' }).closest('form')!)
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/1 of 2 email invites/))
    expect(screen.getByText(/two@example.test.*Email limit reached/)).toBeDefined()
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { type: 'email', email: 'one@example.test', message: 'Welcome to the league.' },
      { type: 'email', email: 'two@example.test', message: 'Welcome to the league.' },
    ])
  })

  it('exports co-owners and repeat managers as consistent aliases and retains open seats', () => {
    const csv = buildTeamDirectoryCsv([
      makeTeam(1, { status: 'managed', manager }),
      makeTeam(2, { status: 'managed', manager, coOwners: [{ id: 'co-private-id', accepted: false }] }),
      makeTeam(3, { name: '=unsafe' }),
    ])
    expect(csv.match(/"Primary","Manager 1"/g)).toHaveLength(2)
    expect(csv).toContain('"Co-owner invited","Manager 2"')
    expect(csv).toContain('"\'=unsafe"')
    expect(csv).toContain('"open","",""')
    expect(csv).not.toContain('private-')
  })
})
