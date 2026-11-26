/**
 * The review step of a pasted Yahoo import: "Which team is yours?", a one-line reason whenever the
 * Import button is disabled, and an honest answer when the league was already imported.
 *
 * Production 2026-11-25: the owner imported with the button greyed out until a checkbox was ticked
 * (no word of why), every team landed unclaimed (nothing asked which was theirs), and a second plain
 * import returned the old league untouched while the screen said "Imported".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ preview: vi.fn(), submit: vi.fn() }))
vi.mock('@/components/core-app/import/yahooCopyPaste', () => ({
  OPEN_YAHOO_COPY_PASTE_EVENT: 'af:test-open-yahoo',
  useYahooCopyPasteEnabled: () => true,
}))
vi.mock('@/lib/league-import/LeagueCreationImportSubmissionService', () => ({
  fetchImportPreview: h.preview,
  submitImportCreation: h.submit,
}))

import {
  YahooSnapshotImport,
  yahooImportBlockedHint,
  YAHOO_NO_TEAM,
} from '@/components/core-app/import/YahooSnapshotImport'

const CHECKLIST = {
  leagueId: '424242',
  leagueName: 'Moonbase Fantasy',
  settings: true,
  standings: true,
  draft: false,
  teams: [
    { name: 'Lunar Landers', hasRoster: true },
    { name: 'Crater Kings', hasRoster: true },
  ],
  unmatchedRosters: [],
  ready: true,
  missing: [],
  links: { settings: 'https://x.test/s', standings: 'https://x.test/t', draft: 'https://x.test/d' },
}

const PREVIEW = {
  league: { name: 'Moonbase Fantasy', season: 2026, teamCount: 2 },
  managers: [
    { rosterId: 'nfl.l.424242.t.1', teamName: 'Lunar Landers', displayName: 'Quill' },
    { rosterId: 'nfl.l.424242.t.2', teamName: 'Crater Kings', displayName: 'Bex' },
  ],
  rosterPositions: ['QB', 'BN'],
  draftPickCount: 0,
}

beforeEach(() => {
  h.preview.mockResolvedValue({ ok: true, data: PREVIEW })
  h.submit.mockResolvedValue({ ok: true, data: { league: { id: 'lg-y', name: 'Moonbase Fantasy', sport: 'NFL' } }, existed: false })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true, sourceId: 'yahoo-snapshot:424242', checklist: CHECKLIST }) })),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function openReview() {
  render(<YahooSnapshotImport />)
  fireEvent.change(screen.getByPlaceholderText('football.fantasysports.yahoo.com/f1/123456'), {
    target: { value: '424242' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Review import →' }))
  await screen.findByText('Which team is yours?')
}

const hint = () => screen.queryByTestId('yahoo-import-blocked-hint')
const importButton = () => screen.getByRole('button', { name: 'Import league' }) as HTMLButtonElement

describe('yahooImportBlockedHint', () => {
  it('names every missing step, and is null only when nothing is missing', () => {
    expect(yahooImportBlockedHint(false, '')).toBe('To import, pick your team and tick “I’m the commissioner of this league”.')
    expect(yahooImportBlockedHint(true, '')).toBe('To import, pick your team.')
    expect(yahooImportBlockedHint(false, 'nfl.l.1.t.1')).toBe('To import, tick “I’m the commissioner of this league”.')
    expect(yahooImportBlockedHint(true, 'nfl.l.1.t.1')).toBeNull()
    expect(yahooImportBlockedHint(true, YAHOO_NO_TEAM)).toBeNull()
  })
})

describe('the review step', () => {
  it('shows the hint exactly while Import is disabled, then claims the picked team', async () => {
    await openReview()
    expect(importButton().disabled).toBe(true)
    expect(hint()?.textContent).toContain('pick your team')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nfl.l.424242.t.2' } })
    expect(importButton().disabled).toBe(true)
    expect(hint()?.textContent).toBe('To import, tick “I’m the commissioner of this league”.')

    fireEvent.click(screen.getByRole('checkbox'))
    expect(importButton().disabled).toBe(false)
    expect(hint()).toBeNull()

    fireEvent.click(importButton())
    await screen.findByText(/Imported Moonbase Fantasy/)
    expect(h.submit).toHaveBeenCalledWith(
      'yahoo',
      'yahoo-snapshot:424242',
      '',
      expect.objectContaining({ accepted: true }),
      { claimSourceTeamId: 'nfl.l.424242.t.2' },
    )
  })

  it('lists the teams by name, manager alongside', async () => {
    await openReview()
    expect(screen.getByRole('option', { name: 'Crater Kings (Bex)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: "I don't have a team in this league" })).toBeTruthy()
  })

  it('a commissioner with no team claims nothing', async () => {
    await openReview()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: YAHOO_NO_TEAM } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(importButton())
    await screen.findByText(/Imported Moonbase Fantasy/)
    expect(h.submit.mock.calls[0]![4]).toEqual({})
  })

  it('an already-imported league is offered the update instead of a false "Imported", and the update sends the team', async () => {
    h.submit.mockResolvedValueOnce({ ok: true, data: { league: { id: 'lg-y', name: 'Moonbase Fantasy', sport: 'NFL' } }, existed: true })
    await openReview()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nfl.l.424242.t.1' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(importButton())

    const update = await screen.findByRole('button', { name: 'Update my existing league' })
    expect(screen.queryByText(/Imported Moonbase Fantasy/)).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('already in your account')

    fireEvent.click(update)
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(2))
    expect(h.submit.mock.calls[1]![4]).toEqual({ force: true, claimSourceTeamId: 'nfl.l.424242.t.1' })
    await screen.findByText(/Updated Moonbase Fantasy/)
  })
})
