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

const CHOOSE = 'choose “I’m the commissioner” or “I’m a member of this league”'

describe('yahooImportBlockedHint', () => {
  it('names every missing step, and is null only when nothing is missing', () => {
    expect(yahooImportBlockedHint(null, '')).toBe(`To import, pick your team and ${CHOOSE}.`)
    expect(yahooImportBlockedHint('me', '')).toBe('To import, pick your team.')
    expect(yahooImportBlockedHint(null, 'nfl.l.1.t.1')).toBe(`To import, ${CHOOSE}.`)
    expect(yahooImportBlockedHint('me', 'nfl.l.1.t.1')).toBeNull()
    expect(yahooImportBlockedHint('me', YAHOO_NO_TEAM)).toBeNull()
  })

  it('a member must pick a real team — "no team" is a commissioner-only answer', () => {
    expect(yahooImportBlockedHint('member', '')).toBe('To import, pick your team.')
    expect(yahooImportBlockedHint('member', YAHOO_NO_TEAM)).toBe('To import, pick your team.')
    expect(yahooImportBlockedHint('member', 'nfl.l.1.t.1')).toBeNull()
  })
})

describe('the review step', () => {
  it('shows the hint exactly while Import is disabled, then claims the picked team', async () => {
    await openReview()
    expect(importButton().disabled).toBe(true)
    expect(hint()?.textContent).toContain('pick your team')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nfl.l.424242.t.2' } })
    expect(importButton().disabled).toBe(true)
    expect(hint()?.textContent).toBe(`To import, ${CHOOSE}.`)

    fireEvent.click(screen.getByTestId('yahoo-run-by-me'))
    expect(importButton().disabled).toBe(false)
    expect(hint()).toBeNull()

    fireEvent.click(importButton())
    await screen.findByText(/Imported Moonbase Fantasy/)
    expect(h.submit).toHaveBeenCalledWith(
      'yahoo',
      'yahoo-snapshot:424242',
      '',
      expect.objectContaining({ accepted: true }),
      { yahooLeagueRunBy: 'me', claimSourceTeamId: 'nfl.l.424242.t.2' },
    )
  })

  it('a MEMBER imports with their team and sends NO commissioner attestation', async () => {
    await openReview()
    fireEvent.click(screen.getByTestId('yahoo-run-by-member'))
    expect(screen.queryByRole('option', { name: "I don't have a team in this league" })).toBeNull()
    expect(importButton().disabled).toBe(true)
    expect(hint()?.textContent).toBe('To import, pick your team.')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nfl.l.424242.t.1' } })
    expect(importButton().disabled).toBe(false)
    fireEvent.click(importButton())
    await screen.findByText(/You joined as a member/)
    expect(h.submit).toHaveBeenCalledWith('yahoo', 'yahoo-snapshot:424242', '', undefined, {
      yahooLeagueRunBy: 'member',
      claimSourceTeamId: 'nfl.l.424242.t.1',
    })
  })

  it('switching a no-team commissioner answer to member clears the team pick', async () => {
    await openReview()
    fireEvent.click(screen.getByTestId('yahoo-run-by-me'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: YAHOO_NO_TEAM } })
    expect(importButton().disabled).toBe(false)
    fireEvent.click(screen.getByTestId('yahoo-run-by-member'))
    expect(importButton().disabled).toBe(true)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
  })

  it('a member can update their existing league too, still without an attestation', async () => {
    h.submit.mockResolvedValueOnce({ ok: true, data: { league: { id: 'lg-y', name: 'Moonbase Fantasy', sport: 'NFL' } }, existed: true })
    await openReview()
    fireEvent.click(screen.getByTestId('yahoo-run-by-member'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nfl.l.424242.t.2' } })
    fireEvent.click(importButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Update my existing league' }))
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(2))
    expect(h.submit.mock.calls[1]![3]).toBeUndefined()
    expect(h.submit.mock.calls[1]![4]).toEqual({ yahooLeagueRunBy: 'member', force: true, claimSourceTeamId: 'nfl.l.424242.t.2' })
    await screen.findByText(/Updated Moonbase Fantasy/)
  })

  it('lists the teams by name, manager alongside', async () => {
    await openReview()
    expect(screen.getByRole('option', { name: 'Crater Kings (Bex)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: "I don't have a team in this league" })).toBeTruthy()
  })

  it('a commissioner with no team claims nothing', async () => {
    await openReview()
    fireEvent.click(screen.getByTestId('yahoo-run-by-me'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: YAHOO_NO_TEAM } })
    fireEvent.click(importButton())
    await screen.findByText(/Imported Moonbase Fantasy/)
    expect(h.submit.mock.calls[0]![4]).toEqual({ yahooLeagueRunBy: 'me' })
  })

  it('an already-imported league is offered the update instead of a false "Imported", and the update sends the team', async () => {
    h.submit.mockResolvedValueOnce({ ok: true, data: { league: { id: 'lg-y', name: 'Moonbase Fantasy', sport: 'NFL' } }, existed: true })
    await openReview()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nfl.l.424242.t.1' } })
    fireEvent.click(screen.getByTestId('yahoo-run-by-me'))
    fireEvent.click(importButton())

    const update = await screen.findByRole('button', { name: 'Update my existing league' })
    expect(screen.queryByText(/Imported Moonbase Fantasy/)).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('already in your account')

    fireEvent.click(update)
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(2))
    expect(h.submit.mock.calls[1]![4]).toEqual({ yahooLeagueRunBy: 'me', force: true, claimSourceTeamId: 'nfl.l.424242.t.1' })
    await screen.findByText(/Updated Moonbase Fantasy/)
  })
})
