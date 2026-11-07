/**
 * Import v5 (2026-11-06): the wrong-box paste hint, the league list's Select all / Clear, and the
 * per-platform guide. Each guards a failure the redesign was written against — see ImportGuide's
 * header for the research behind them.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const discoverProviderLeagues = vi.fn()
const submitImportCreation = vi.fn()
const fetchImportPreview = vi.fn()

vi.mock('@/lib/league-import/LeagueCreationImportSubmissionService', () => ({
  discoverProviderLeagues: (...a: unknown[]) => discoverProviderLeagues(...a),
  submitImportCreation: (...a: unknown[]) => submitImportCreation(...a),
  fetchImportPreview: (...a: unknown[]) => fetchImportPreview(...a),
}))
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

import ImportV4 from '@/components/core-app/screens/ImportV4'

const LEAGUES = [
  { sourceId: 'l1', name: 'Dynasty Dragons', season: '2026', totalTeams: 12 },
  { sourceId: 'l2', name: 'Sunday Scaries', season: '2026', totalTeams: 10 },
  { sourceId: 'l3', name: 'Removed One', season: '2026', totalTeams: 12, previouslyDeleted: true },
]

beforeEach(() => {
  discoverProviderLeagues.mockReset()
  submitImportCreation.mockReset()
  fetchImportPreview.mockReset()
  discoverProviderLeagues.mockResolvedValue({ ok: false, error: 'needs an identifier' })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ auths: [] }) })) as unknown as typeof fetch)
})

describe('wrong-box paste hint', () => {
  it('names the platform of a pasted link and switches to it, keeping the link', async () => {
    render(<ImportV4 defaultProvider="sleeper" />)
    const input = document.querySelector<HTMLInputElement>('[data-testid="import-discovery-account"]')!
    fireEvent.change(input, { target: { value: 'https://fantasy.espn.com/football/league?leagueId=123456' } })

    await waitFor(() => expect(document.querySelector('.af-im-wrongbox')?.textContent).toMatch(/an ESPN link/))

    fireEvent.click(screen.getByRole('button', { name: /Switch to ESPN/ }))
    await waitFor(() =>
      expect(screen.getByTestId('import-tab-espn').getAttribute('data-active')).toBe('true'),
    )
    const after = document.querySelector<HTMLInputElement>('[data-testid="import-discovery-account"]')!
    expect(after.value).toBe('https://fantasy.espn.com/football/league?leagueId=123456')
    expect(document.querySelector('.af-im-wrongbox')).toBeNull()
  })

  it('says nothing for a bare id, which every league-id platform shares', () => {
    render(<ImportV4 defaultProvider="espn" />)
    const input = document.querySelector<HTMLInputElement>('[data-testid="import-discovery-account"]')!
    fireEvent.change(input, { target: { value: '123456' } })
    expect(document.querySelector('.af-im-wrongbox')).toBeNull()
  })

  it('offers no switch to a paused platform', () => {
    render(<ImportV4 defaultProvider="espn" />)
    const input = document.querySelector<HTMLInputElement>('[data-testid="import-discovery-account"]')!
    fireEvent.change(input, { target: { value: 'https://football.fantasysports.yahoo.com/f1/123456' } })
    expect(document.querySelector('.af-im-wrongbox')?.textContent).toMatch(/coming soon/i)
    expect(screen.queryByRole('button', { name: /Switch to Yahoo/ })).toBeNull()
  })
})

describe('Select all / Clear', () => {
  it('clears every tick, and Select all restores the defaults without sweeping in a removed league', async () => {
    discoverProviderLeagues.mockResolvedValue({ ok: true, data: { leagues: LEAGUES, accountLabel: 'me' } })
    render(<ImportV4 defaultProvider="sleeper" />)
    await screen.findByText('Dynasty Dragons')
    expect(screen.getByText('2 of 3 selected')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('0 of 3 selected')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Pick at least one league/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('2 of 3 selected')).toBeTruthy()
    expect(
      (screen.getByLabelText('Include Removed One in the import') as HTMLInputElement).checked,
    ).toBe(false)
  })
})

describe('the connect guide', () => {
  it('walks ESPN in four steps, browser-specific, with the phone caveat', async () => {
    render(<ImportV4 defaultProvider="espn" />)
    expect(screen.getByText('ESPN in 4 steps')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Chrome / Edge' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Safari' })).toBeTruthy()
    expect(screen.getByText(/Phone browsers can.t show cookies/)).toBeTruthy()
  })

  it('offers Fantrax both ways in', () => {
    render(<ImportV4 defaultProvider="fantrax" />)
    expect(screen.getByRole('tab', { name: /Secret ID/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /League ID/ }))
    expect(screen.getByText('Pick which team is yours')).toBeTruthy()
  })
})
