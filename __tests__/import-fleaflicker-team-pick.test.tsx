/**
 * /import, the preview → commit hand-off, for the fixes found clicking through all six providers.
 *
 *  - FLEAFLICKER NEVER IDENTIFIED THE IMPORTER'S TEAM. The preview now asks "Which team is yours?"
 *    (the same rows and "This is my team" button Fantrax uses), Import waits for a pick, and the
 *    pick is sent as `claimSourceTeamId` — through the attestation step too.
 *  - "Confirm and continue" re-ran the PREVIEW, so the person pressed Import twice. It now commits.
 *  - The preview named the provider by its internal id ("from fleaflicker").
 *  - The preview showed no per-bucket coverage; it now lists each one, state in words.
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

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

/* The done screen's league-type check fetches on mount; it is not under test here. */
vi.mock('@/components/league/LeagueTypeConfirm', () => ({ default: () => null }))

import ImportV4 from '@/components/core-app/screens/ImportV4'

const FLEA_PREVIEW = {
  league: { name: 'Jackpot Dynasty League' },
  managers: [
    { rosterId: '1001', teamName: 'Gridiron Gang', displayName: 'Alice' },
    { rosterId: '1002', teamName: 'Waiver Wire Wizards', displayName: 'Bob' },
  ],
  dataQuality: {
    coverageSummary: [
      { key: 'currentRosters', label: 'Current rosters', state: 'full', count: 12 },
      { key: 'currentSchedule', label: 'Schedule', state: 'missing', count: null },
      { key: 'tradeHistory', label: 'Trade history', state: 'partial', count: 3 },
      { key: 'someNewBucket', label: 'Some new bucket', state: 'full', count: 1 },
    ],
  },
}

const COMMITTED = { ok: true, data: { leagueId: 'lg-1', name: 'Jackpot Dynasty League' } }

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ auths: [] }) })) as unknown as typeof fetch,
  )
  discoverProviderLeagues.mockReset()
  fetchImportPreview.mockReset()
  submitImportCreation.mockReset()
  discoverProviderLeagues.mockResolvedValue({ ok: false, error: 'no discovery' })
})

async function openFleaPreview() {
  fetchImportPreview.mockResolvedValue({ ok: true, data: FLEA_PREVIEW })
  render(<ImportV4 defaultProvider="fleaflicker" initialLeagueSourceId="206154" />)
  return screen.findByTestId('import-preview-team-pick')
}

describe('🛑 Fleaflicker: "Which team is yours?" on the preview', () => {
  it('lists every team from the preview with a "This is my team" button', async () => {
    const pick = await openFleaPreview()
    expect(pick.textContent).toContain('Gridiron Gang')
    expect(pick.textContent).toContain('Waiver Wire Wizards')
    expect(screen.getAllByText('This is my team')).toHaveLength(2)
  })

  it('Import waits for a pick', async () => {
    await openFleaPreview()
    const importButton = screen.getByTestId('import-commit') as HTMLButtonElement
    expect(importButton.disabled).toBe(true)
    expect(importButton.textContent).toContain('Pick your team first')
    fireEvent.click(importButton)
    expect(submitImportCreation).not.toHaveBeenCalled()
  })

  it('sends the picked team with the commit as claimSourceTeamId', async () => {
    submitImportCreation.mockResolvedValue(COMMITTED)
    await openFleaPreview()

    fireEvent.click(screen.getByTestId('import-preview-team-1002'))
    const importButton = screen.getByTestId('import-commit') as HTMLButtonElement
    expect(importButton.disabled).toBe(false)
    fireEvent.click(importButton)

    await waitFor(() => expect(submitImportCreation).toHaveBeenCalled())
    const [provider, sourceId, , , options] = submitImportCreation.mock.calls[0]!
    expect(provider).toBe('fleaflicker')
    expect(sourceId).toBe('206154')
    expect(options).toMatchObject({ claimSourceTeamId: '1002' })
  })

  it('keeps the pick through the attestation step, and "Confirm and continue" commits directly', async () => {
    submitImportCreation
      .mockResolvedValueOnce({
        ok: false,
        requiresAttestation: true,
        error: 'Fleaflicker cannot verify commissioner status automatically — confirm you are the league commissioner to continue.',
      })
      .mockResolvedValueOnce(COMMITTED)
    await openFleaPreview()

    fireEvent.click(screen.getByTestId('import-preview-team-1001'))
    fireEvent.click(screen.getByTestId('import-commit'))

    const confirm = await screen.findByText('Confirm and continue')
    const previewCallsBefore = fetchImportPreview.mock.calls.length
    fireEvent.click(confirm)

    await waitFor(() => expect(submitImportCreation).toHaveBeenCalledTimes(2))
    const [, , , attestation, options] = submitImportCreation.mock.calls[1]!
    expect(attestation).toEqual({ accepted: true })
    expect(options).toMatchObject({ claimSourceTeamId: '1001' })
    // Straight to the commit: no second preview round-trip.
    expect(fetchImportPreview.mock.calls.length).toBe(previewCallsBefore)
  })

  it('names the provider by its label, never its internal id', async () => {
    const pick = await openFleaPreview()
    const section = pick.closest('section')!
    expect(section.textContent).toContain('We read this league from Fleaflicker')
    expect(section.textContent).not.toMatch(/from fleaflicker/)
  })
})

describe('the preview lists what comes across, bucket by bucket', () => {
  it('renders a list with the state in words and counts where they exist', async () => {
    await openFleaPreview()
    const list = screen.getByTestId('import-preview-coverage-list')
    expect(list.tagName).toBe('UL')
    const items = Array.from(list.querySelectorAll('li')).map((li) => li.textContent)
    expect(items).toContain('Rosters: Included (12)')
    expect(items).toContain('Schedule: Not included')
    expect(items).toContain('Trade history: Partial (3)')
  })

  it('drops a bucket it holds no user-facing label for, rather than showing it raw', async () => {
    await openFleaPreview()
    const list = screen.getByTestId('import-preview-coverage-list')
    expect(list.textContent).not.toMatch(/someNewBucket|Some new bucket/)
  })
})

describe('other providers are unchanged', () => {
  it('an ESPN preview asks for no team and Import is enabled', async () => {
    fetchImportPreview.mockResolvedValue({
      ok: true,
      data: { ...FLEA_PREVIEW, league: { name: 'My ESPN League' } },
    })
    render(<ImportV4 defaultProvider="espn" initialLeagueSourceId="12345" />)
    await screen.findByText('Ready to import')
    expect(screen.queryByTestId('import-preview-team-pick')).toBeNull()
    expect((screen.getByTestId('import-commit') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('tile copy', () => {
  it('Fantrax: the placeholder is an obviously invented id, and the help is about THIS box', () => {
    render(<ImportV4 defaultProvider="fantrax" />)
    const input = screen.getByTestId('import-discovery-account') as HTMLInputElement
    expect(input.placeholder).not.toContain('v2kzedypmm8jp61b')
    expect(input.placeholder).toMatch(/^abcd1234efgh5678/)
    expect(document.body.textContent).toContain('This box never needs your Fantrax password or Secret ID.')
    expect(document.body.textContent).not.toContain('Never your Fantrax password')
  })

  it('MFL: the tile links to the page where the API key is actually saved', () => {
    render(<ImportV4 defaultProvider="mfl" />)
    const link = screen.getByTestId('import-mfl-key-link')
    expect(link.getAttribute('href')).toBe('/settings?tab=connected')
    expect(document.body.textContent).toContain('Settings → Connected Accounts')
  })

  it('MFL: the missing-key error names the same place and links to it', async () => {
    fetchImportPreview.mockResolvedValue({
      ok: false,
      error: 'Save your MFL API key under Settings → Connected Accounts before importing from MyFantasyLeague.',
    })
    render(<ImportV4 defaultProvider="mfl" initialLeagueSourceId="12345" />)
    const link = await screen.findByTestId('import-mfl-key-error-link')
    expect(link.getAttribute('href')).toBe('/settings?tab=connected')
    expect(screen.getByRole('alert').textContent).not.toMatch(/League Sync/)
  })
})

describe('🛑 a Sleeper handle linked to a different AllFantasy login', () => {
  it('says so on the discovered list, before anyone presses Import', async () => {
    discoverProviderLeagues.mockResolvedValue({
      ok: true,
      data: {
        leagues: [{ sourceId: 'L1', name: 'Main Event', season: '2026', sport: 'nfl', totalTeams: 12 }],
        handleLinkedElsewhere: true,
      },
    })
    render(<ImportV4 defaultProvider="sleeper" />)
    fireEvent.change(screen.getByTestId('import-discovery-account'), { target: { value: 'theciege24' } })
    fireEvent.keyDown(screen.getByTestId('import-discovery-account'), { key: 'Enter' })

    const notice = await screen.findByTestId('import-sleeper-linked-elsewhere')
    expect(notice.textContent).toContain(
      'This Sleeper account is already linked to a different AllFantasy login. Sign in with that account to import these leagues.',
    )
  })

  it('is silent when the handle is not linked elsewhere', async () => {
    discoverProviderLeagues.mockResolvedValue({
      ok: true,
      data: { leagues: [{ sourceId: 'L1', name: 'Main Event', season: '2026', sport: 'nfl', totalTeams: 12 }] },
    })
    render(<ImportV4 defaultProvider="sleeper" />)
    fireEvent.change(screen.getByTestId('import-discovery-account'), { target: { value: 'theciege24' } })
    fireEvent.keyDown(screen.getByTestId('import-discovery-account'), { key: 'Enter' })

    await screen.findByText('Main Event')
    expect(screen.queryByTestId('import-sleeper-linked-elsewhere')).toBeNull()
  })
})
