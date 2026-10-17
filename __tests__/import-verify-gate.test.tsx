/**
 * /import's verify step (2026-10-11). The import routes refuse an unverified account with 403
 * VERIFICATION_REQUIRED, and the screen used to answer with one sentence and nothing to press.
 * Measured: 14 accounts linked Sleeper, read ~24 pages each, and never imported.
 *
 *  - the service carries the refusal as a flag, never re-read from the sentence;
 *  - the screen shows a card that sends the link (the EXISTING send route) and carries on where it
 *    stopped — on its own for a read, only on a tap for an import, which writes;
 *  - the Sleeper lookup that runs on select is no longer silent about it;
 *  - a bulk run stops at the first refusal instead of failing every row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { inboxShortcutFor, readSendOutcome } from '@/lib/core-app/importVerifyGate'

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
vi.mock('@/components/league/LeagueTypeConfirm', () => ({ default: () => null }))

import ImportV4 from '@/components/core-app/screens/ImportV4'

const REFUSED = {
  ok: false,
  status: 403,
  error: 'Verify your email or phone before importing a league.',
  verificationRequired: true,
}
const LEAGUES = [
  { sourceId: 'L1', name: 'League One', sport: 'NFL', season: '2026' },
  { sourceId: 'L2', name: 'League Two', sport: 'NFL', season: '2026' },
  { sourceId: 'L3', name: 'League Three', sport: 'NFL', season: '2026' },
]

let sendResponse: { status: number; body: unknown }
const fetchMock = vi.fn()

function calls(url: string) {
  return fetchMock.mock.calls.filter((c) => c[0] === url)
}
function tracked(): string[] {
  return calls('/api/analytics/track').map((c) => JSON.parse((c[1] as { body: string }).body).event)
}

beforeEach(() => {
  sendResponse = { status: 200, body: { ok: true } }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/auth/verify-email/send') {
      return { ok: sendResponse.status < 300, status: sendResponse.status, json: async () => sendResponse.body }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, auths: [] }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  discoverProviderLeagues.mockReset()
  fetchImportPreview.mockReset()
  submitImportCreation.mockReset()
  discoverProviderLeagues.mockResolvedValue(REFUSED)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('helpers', () => {
  it('inbox shortcut: Gmail searches every folder for our sender; unknown domains get none', () => {
    expect(inboxShortcutFor('Someone@Gmail.com')?.href).toContain('mail.google.com')
    expect(inboxShortcutFor('a@gmail.com')?.href).toContain('in%3Aanywhere')
    expect(inboxShortcutFor('a@aol.com')?.label).toBe('Open Yahoo Mail')
    expect(inboxShortcutFor('a@hotmail.com')?.label).toBe('Open Outlook')
    expect(inboxShortcutFor('a@me.com')?.label).toBe('Open iCloud Mail')
    expect(inboxShortcutFor('a@gmai.com')).toBeNull()
    expect(inboxShortcutFor(null)).toBeNull()
  })

  it('send outcome: a 502 is never "sent", a 429 says wait, alreadyVerified is its own answer', () => {
    expect(readSendOutcome(200, { ok: true })).toEqual({ k: 'sent' })
    expect(readSendOutcome(200, { ok: true, alreadyVerified: true })).toEqual({ k: 'already_verified' })
    expect(readSendOutcome(429, { error: 'RATE_LIMITED', message: 'Please wait 60 seconds.' })).toEqual({
      k: 'wait',
      message: 'Please wait 60 seconds.',
    })
    expect(readSendOutcome(502, { error: 'EMAIL_SEND_FAILED' }).k).toBe('failed')
    expect(readSendOutcome(200, null).k).toBe('failed')
  })
})

describe('🛑 the Sleeper lookup on select is no longer silent for an unverified account', () => {
  it('shows the card, names the address, and is not a red error', async () => {
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    const gate = await screen.findByTestId('import-verify-gate')
    expect(gate.textContent).toContain('Confirm your email to bring your leagues in')
    expect(gate.textContent).toContain('manager@gmail.com')
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(tracked()).toContain('import_verify_shown'))
  })

  it('other failures of that lookup stay silent, as before', async () => {
    discoverProviderLeagues.mockResolvedValue({ ok: false, status: 404, error: 'Not linked' })
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    await waitFor(() => expect(discoverProviderLeagues).toHaveBeenCalled())
    expect(screen.queryByTestId('import-verify-gate')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('sending the link', () => {
  it('uses the existing send route with this screen as returnTo, then points at the inbox', async () => {
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Email me the link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to manager@gmail.com')
    const [, init] = calls('/api/auth/verify-email/send')[0]
    expect(JSON.parse((init as { body: string }).body)).toEqual({ returnTo: '/import?provider=sleeper' })
    expect(screen.getByRole('link', { name: 'Open Gmail' }).getAttribute('href')).toContain('mail.google.com')
    expect(tracked()).toContain('import_verify_link_sent')
  })

  it('a resend inside the cooldown keeps the "sent" view and says to wait', async () => {
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Email me the link' }))
    await screen.findByRole('status')
    sendResponse = { status: 429, body: { error: 'RATE_LIMITED', message: 'Please wait 60 seconds before requesting another email.' } }
    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait 60 seconds')
    expect(screen.getByRole('link', { name: 'Open Gmail' })).toBeTruthy()
  })

  it('a failed send is said plainly and never shown as sent', async () => {
    sendResponse = { status: 502, body: { error: 'EMAIL_SEND_FAILED', message: 'We couldn’t send the verification email right now.' } }
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Email me the link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t send')
    expect(screen.queryByText(/Sent to/)).toBeNull()
  })

  it('already verified (e.g. in another tab): carries straight on', async () => {
    sendResponse = { status: 200, body: { ok: true, alreadyVerified: true } }
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    const button = await screen.findByRole('button', { name: 'Email me the link' })
    discoverProviderLeagues.mockResolvedValue({ ok: true, data: { leagues: LEAGUES } })
    fireEvent.click(button)
    expect(await screen.findByText('League One')).toBeTruthy()
    expect(screen.queryByTestId('import-verify-gate')).toBeNull()
  })

  it('offers phone verification, coming back to this screen', async () => {
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    const phone = await screen.findByRole('link', { name: 'Use your phone instead' })
    expect(phone.getAttribute('href')).toBe(
      `/verify?error=VERIFICATION_REQUIRED&returnTo=${encodeURIComponent('/import?provider=sleeper')}`,
    )
  })
})

describe('carrying on', () => {
  it('"continue" too early keeps the card (and "sent to"); after confirming, the leagues appear', async () => {
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Email me the link' }))
    await screen.findByRole('status')

    fireEvent.click(screen.getByRole('button', { name: 'I’ve confirmed — continue' }))
    await waitFor(() => expect(discoverProviderLeagues).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('import-verify-gate').textContent).toContain('Sent to')

    discoverProviderLeagues.mockResolvedValue({ ok: true, data: { leagues: LEAGUES } })
    fireEvent.click(screen.getByRole('button', { name: 'I’ve confirmed — continue' }))
    expect(await screen.findByText('League One')).toBeTruthy()
    expect(screen.queryByTestId('import-verify-gate')).toBeNull()
    expect(tracked()).toContain('import_verify_continue')
  })

  it('a lookup resumes on its own when the tab comes back', async () => {
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    const focusListener = vi.spyOn(window, 'addEventListener')
    fireEvent.click(await screen.findByRole('button', { name: 'Email me the link' }))
    // Wait for both the sent state and its passive focus listener. Under a
    // loaded CI shard the DOM can commit before React installs the listener.
    await screen.findByText(/Sent to/)
    await waitFor(() => expect(focusListener).toHaveBeenCalledWith('focus', expect.any(Function)))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    discoverProviderLeagues.mockResolvedValue({ ok: true, data: { leagues: LEAGUES } })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText('League One', {}, { timeout: 10_000 })).toBeTruthy()
    visibility.mockRestore()
    focusListener.mockRestore()
  })

  it('🛑 an IMPORT (a write) never re-runs on focus — only on a tap, with the same arguments', async () => {
    discoverProviderLeagues.mockResolvedValue({ ok: false, status: 404, error: 'none' })
    fetchImportPreview.mockResolvedValue({ ok: true, data: { league: { name: 'Deep Link League' } } })
    submitImportCreation.mockResolvedValue(REFUSED)
    render(<ImportV4 defaultProvider="sleeper" initialLeagueSourceId="999" viewerEmail="manager@gmail.com" />)
    fireEvent.click(await screen.findByTestId('import-commit'))
    fireEvent.click(await screen.findByRole('button', { name: 'Email me the link' }))
    await screen.findByRole('status')

    const [, init] = calls('/api/auth/verify-email/send')[0]
    expect(JSON.parse((init as { body: string }).body).returnTo).toBe('/import?provider=sleeper&leagueId=999')

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(submitImportCreation).toHaveBeenCalledTimes(1)

    submitImportCreation.mockResolvedValue({ ok: true, data: { leagueId: 'lg-1', name: 'Deep Link League' } })
    fireEvent.click(screen.getByRole('button', { name: 'I’ve confirmed — continue' }))
    await waitFor(() => expect(submitImportCreation).toHaveBeenCalledTimes(2))
    expect(submitImportCreation.mock.calls[1].slice(0, 2)).toEqual(['sleeper', '999'])
    await waitFor(() => expect(screen.queryByTestId('import-verify-gate')).toBeNull())
  })

  it('switching provider drops a refusal that belonged to the previous one', async () => {
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    await screen.findByTestId('import-verify-gate')
    fireEvent.click(screen.getByTestId('import-tab-espn'))
    await waitFor(() => expect(screen.queryByTestId('import-verify-gate')).toBeNull())
  })
})

describe('🛑 bulk import stops at the first refusal', () => {
  it('one request, no row marked failed, and the card instead of a summary', async () => {
    discoverProviderLeagues.mockResolvedValue({ ok: true, data: { leagues: LEAGUES } })
    submitImportCreation.mockResolvedValue(REFUSED)
    render(<ImportV4 defaultProvider="sleeper" viewerEmail="manager@gmail.com" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Import 3 leagues' }))
    expect(await screen.findByTestId('import-verify-gate')).toBeTruthy()
    expect(submitImportCreation).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Verify your email or phone/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Import 3 leagues' })).toBeTruthy()
  })
})
