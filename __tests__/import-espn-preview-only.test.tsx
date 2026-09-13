/**
 * Owner decision "A1", 2026-09-12 — a public ESPN league previewed without a connected ESPN account.
 *
 * The server now answers that case with the preview plus `importable: false` and the gate's reason,
 * but only when the client asks (`allowPreviewOnly`). This screen is the one client that asks, so it
 * owes two things: say plainly that this is a preview and why, and make Import impossible to press.
 * The commit route would refuse anyway; a button that invites a guaranteed failure is still wrong.
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
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

import ImportV4 from '@/components/core-app/screens/ImportV4'

const REASON =
  'We could read this league, but not prove you have a team in it — that needs your ESPN account connected.'

beforeEach(() => {
  // The ESPN panel fetches its connection status on mount; not connected is the case under test.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ auths: [] }) })) as unknown as typeof fetch,
  )
  discoverProviderLeagues.mockReset()
  fetchImportPreview.mockReset()
  submitImportCreation.mockReset()
  discoverProviderLeagues.mockResolvedValue({ ok: false, error: 'needs an identifier' })
})

describe('ImportV4 — ESPN preview-only', () => {
  it('asks the server for a preview-only answer', async () => {
    fetchImportPreview.mockResolvedValue({
      ok: true,
      data: { league: { name: 'Public ESPN League' }, importable: false, importBlockedReason: REASON },
    })
    render(<ImportV4 defaultProvider="espn" initialLeagueSourceId="12345" />)

    await waitFor(() => expect(fetchImportPreview).toHaveBeenCalled())
    expect(fetchImportPreview).toHaveBeenCalledWith('espn', '12345', undefined, {
      allowPreviewOnly: true,
    })
  })

  it('shows the league, labels it a preview, gives the reason, and disables Import', async () => {
    fetchImportPreview.mockResolvedValue({
      ok: true,
      data: { league: { name: 'Public ESPN League' }, importable: false, importBlockedReason: REASON },
    })
    render(<ImportV4 defaultProvider="espn" initialLeagueSourceId="12345" />)

    const blocked = await screen.findByTestId('import-preview-blocked')
    expect(blocked.textContent).toBe(REASON)

    const section = blocked.closest('section')!
    expect(section.textContent).toContain('Public ESPN League')
    expect(section.textContent).toContain('Preview only')
    expect(section.textContent).not.toContain('Ready to import')

    const importButton = section.querySelector<HTMLButtonElement>('.af-im-submit')!
    expect(importButton.textContent).toContain('Import this league')
    expect(importButton.disabled).toBe(true)
    fireEvent.click(importButton)
    expect(submitImportCreation).not.toHaveBeenCalled()
  })

  it('leaves an ordinary preview importable — a missing importable field is not a block', async () => {
    fetchImportPreview.mockResolvedValue({
      ok: true,
      data: { league: { name: 'My ESPN League' } },
    })
    render(<ImportV4 defaultProvider="espn" initialLeagueSourceId="12345" />)

    const heading = await screen.findByText('Ready to import')
    const section = heading.closest('section')!
    expect(section.textContent).toContain('My ESPN League')
    expect(screen.queryByTestId('import-preview-blocked')).toBeNull()
    expect(section.querySelector<HTMLButtonElement>('.af-im-submit')!.disabled).toBe(false)
  })
})
