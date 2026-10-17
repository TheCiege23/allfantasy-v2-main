/**
 * /import "Find my leagues": one lookup at a time, and only the latest one may write to the screen.
 *
 * Enter in the username field used to start a lookup while one was already running (only the
 * button was disabled), and lookups resolve in any order, so an old "not found" could replace the
 * leagues found for the corrected username.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const discoverProviderLeagues = vi.fn()

vi.mock('@/lib/league-import/LeagueCreationImportSubmissionService', () => ({
  discoverProviderLeagues: (...a: unknown[]) => discoverProviderLeagues(...a),
  submitImportCreation: vi.fn(),
  fetchImportPreview: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

import ImportV4 from '@/components/core-app/screens/ImportV4'

type DiscoverResult = Awaited<ReturnType<typeof import('@/lib/league-import/LeagueCreationImportSubmissionService').discoverProviderLeagues>>

function deferred() {
  let resolve!: (v: DiscoverResult) => void
  const promise = new Promise<DiscoverResult>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const NOT_FOUND =
  'We could not find a Sleeper account with that username. Check the spelling, or leave the field blank to use your linked Sleeper account.'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ auths: [] }) })) as unknown as typeof fetch,
  )
  discoverProviderLeagues.mockReset()
  // The silent lookup on provider select: no linked account.
  discoverProviderLeagues.mockResolvedValue({ ok: false, error: 'not linked' })
})

async function renderAndSettle() {
  render(<ImportV4 />)
  await waitFor(() => expect(discoverProviderLeagues).toHaveBeenCalledTimes(1))
  return screen.getByTestId('import-discovery-account') as HTMLInputElement
}

describe('/import discovery overlap', () => {
  it('ignores Enter while a lookup is running', async () => {
    const input = await renderAndSettle()
    const pending = deferred()
    discoverProviderLeagues.mockReturnValueOnce(pending.promise)

    fireEvent.change(input, { target: { value: 'typo-user' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByTestId('import-discovery-find'))

    expect(discoverProviderLeagues).toHaveBeenCalledTimes(2)

    await act(async () => {
      pending.resolve({ ok: false, error: NOT_FOUND, status: 404 })
    })
    expect(await screen.findByText(NOT_FOUND)).toBeTruthy()
  })

  it('drops a stale result that arrives after a newer lookup', async () => {
    const input = await renderAndSettle()
    const first = deferred()
    const second = deferred()
    discoverProviderLeagues.mockReturnValueOnce(first.promise)

    fireEvent.change(input, { target: { value: 'typo-user' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Switching tabs resets the screen while the first lookup is still out, so a new one can start.
    const before = discoverProviderLeagues.mock.calls.length
    fireEvent.click(screen.getByTestId('import-tab-espn'))
    fireEvent.click(screen.getByTestId('import-tab-sleeper'))
    await waitFor(() =>
      expect(discoverProviderLeagues.mock.calls.slice(before).some((c) => c[0] === 'sleeper' && c[1] === '')).toBe(true),
    )
    discoverProviderLeagues.mockReturnValueOnce(second.promise)
    const fresh = screen.getByTestId('import-discovery-account') as HTMLInputElement
    fireEvent.change(fresh, { target: { value: 'right-user' } })
    fireEvent.keyDown(fresh, { key: 'Enter' })
    expect(discoverProviderLeagues).toHaveBeenLastCalledWith('sleeper', 'right-user', { sport: 'nfl' })

    await act(async () => {
      second.resolve({
        ok: true,
        data: { leagues: [{ sourceId: 'L1', name: 'Correct League' }], accountLabel: 'right-user' },
      })
    })
    expect(await screen.findByText('Correct League')).toBeTruthy()

    await act(async () => {
      first.resolve({ ok: false, error: NOT_FOUND, status: 404 })
    })
    expect(screen.getByText('Correct League')).toBeTruthy()
    expect(screen.queryByText(NOT_FOUND)).toBeNull()
  })
})
