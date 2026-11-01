// @vitest-environment jsdom
/**
 * The commissioner's "Chimmy as a manager" list: every team, empty seats first, a count against the
 * limit, and no new team offered once Chimmy runs the limit (its own teams can still change style).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import { InactiveManagerCommissioner } from '@/components/core-app/InactiveManagerCommissioner'

const chimmy = (id: string) => ({ rosterId: id, teamName: `Team ${id}`, managerName: null, status: 'unknown', suggested: false, emptySeat: false,
  managed: { since: '2026-10-31T00:00:00Z', byUserId: 'c', autopilot: { style: 'dynasty_owner', since: '2026-10-31T00:00:00Z' } } })
const plain = (id: string, emptySeat = false) => ({ rosterId: id, teamName: emptySeat ? null : `Team ${id}`, managerName: null, status: 'active', suggested: false, emptySeat, managed: null })

function view(teams: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ native: true, autopilotEntitled: true, draftAsMe: true, autoHandover: null, chimmyLimit: 4, teams }) })))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Chimmy as a manager list', () => {
  it('lists empty seats first and counts Chimmy\'s teams', async () => {
    view([plain('a'), plain('b', true), chimmy('c')])
    render(<InactiveManagerCommissioner leagueId="L" />)
    await waitFor(() => expect(screen.getByTestId('chimmy-manager-count').textContent).toBe('Chimmy runs 1 of 4 teams'))
    const rows = screen.getAllByTestId('chimmy-manager-team')
    expect(rows[0].getAttribute('data-empty-seat')).toBe('true')
    expect(rows[0].textContent).toContain('Empty seat')
    expect(screen.queryByTestId('chimmy-manager-limit')).toBeNull()
  })

  it('at the limit, only Chimmy\'s own teams can be changed', async () => {
    view([chimmy('1'), chimmy('2'), chimmy('3'), chimmy('4'), plain('5', true)])
    render(<InactiveManagerCommissioner leagueId="L" />)
    await waitFor(() => expect(screen.getByTestId('chimmy-manager-limit')).toBeTruthy())
    const rows = screen.getAllByTestId('chimmy-manager-team')
    const selectOf = (row: HTMLElement) => row.querySelector('select') as HTMLSelectElement
    expect(selectOf(rows.find(row => row.getAttribute('data-empty-seat') === 'true')!).disabled).toBe(true)
    expect(rows.filter(row => !row.getAttribute('data-empty-seat')).every(row => !selectOf(row).disabled)).toBe(true)
  })
})
