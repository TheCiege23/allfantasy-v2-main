/**
 * An ESPN gate failure on /import must point at a control the ESPN panel actually shows.
 *
 * The hint used to read "Use 'Connect ESPN' above", and EspnConnectPanel has no control with that
 * label. Phone users looked for it, found nothing, and left without importing. These tests check
 * that each label the hint names is on screen, and that the failure is captured for analytics.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { captureMock } = vi.hoisted(() => ({ captureMock: vi.fn() }))
vi.mock('posthog-js', () => ({ default: { capture: captureMock } }))

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

const PRIVATE_REASON =
  'This ESPN league is private, so importing it needs your ESPN account connected. Connect ESPN in ' +
  'Settings → Connected Accounts. That step needs a desktop browser once.'
const NO_TEAM_REASON =
  'Your connected ESPN account has no team in this league. Reconnect ESPN with the account that ' +
  'has a team here — that step needs a desktop browser.'

function stubEspnStatus(connected: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        auths: connected ? [{ platform: 'espn', hasEspnCookies: true, updatedAt: null }] : [],
      }),
    })) as unknown as typeof fetch,
  )
}

beforeEach(() => {
  captureMock.mockReset()
  discoverProviderLeagues.mockReset()
  fetchImportPreview.mockReset()
  submitImportCreation.mockReset()
  discoverProviderLeagues.mockResolvedValue({ ok: false, error: 'needs an identifier' })
})

describe('ImportV4 — ESPN gate error hint', () => {
  it('shows the server reason and names "Save ESPN cookies" in "Manual fallback" when not connected', async () => {
    stubEspnStatus(false)
    fetchImportPreview.mockResolvedValue({ ok: false, error: PRIVATE_REASON, status: 403, code: 'NOT_COMMISSIONER' })
    render(<ImportV4 defaultProvider="espn" initialLeagueSourceId="12345" />)

    await waitFor(() => expect(screen.getByText(PRIVATE_REASON)).toBeTruthy())
    const hint = document.querySelector('.af-im-error-here')!
    expect(hint.textContent).toMatch(/Manual fallback/)
    expect(hint.textContent).toMatch(/Save ESPN cookies/)
    expect(hint.textContent).not.toMatch(/Connect ESPN/)
    // The label the hint names must be on screen.
    expect(await screen.findByRole('button', { name: /Manual fallback/ })).toBeTruthy()
  })

  it('names "Update cookies" when ESPN is already connected', async () => {
    stubEspnStatus(true)
    fetchImportPreview.mockResolvedValue({ ok: false, error: NO_TEAM_REASON, status: 403, code: 'NOT_COMMISSIONER' })
    render(<ImportV4 defaultProvider="espn" />)
    await screen.findByText('ESPN connected')

    const input = document.querySelector<HTMLInputElement>('[data-testid="import-discovery-account"]')!
    fireEvent.change(input, { target: { value: '12345' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText(NO_TEAM_REASON)).toBeTruthy())
    const hint = document.querySelector('.af-im-error-here')!
    expect(hint.textContent).toMatch(/Update cookies/)
    // The panel re-checks its status after an error; the control returns once that check ends.
    expect(await screen.findByRole('button', { name: 'Update cookies' })).toBeTruthy()
    expect(captureMock).toHaveBeenCalledWith('import_gate_result', {
      provider: 'espn',
      stage: 'preview',
      passed: false,
      reason_code: 'NOT_COMMISSIONER',
      espn_connected: true,
    })
  })
})
