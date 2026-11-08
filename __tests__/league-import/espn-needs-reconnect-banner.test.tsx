/**
 * Expired ESPN cookies are SHOWN, not just recorded: when `/api/league/auth` reports the saved
 * connection as needing reconnection, the panel says so above "Update cookies".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { EspnConnectPanel } from '@/components/core-app/import/EspnConnectPanel'

function stubAuth(espn: Record<string, unknown> | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ auths: espn ? [{ platform: 'espn', hasEspnCookies: true, updatedAt: null, ...espn }] : [] }),
    })) as unknown as typeof fetch,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('ESPN needs-reconnect banner', () => {
  it('appears when ESPN refused the saved cookies', async () => {
    stubAuth({ needsReconnect: true })
    render(<EspnConnectPanel />)
    expect(await screen.findByTestId('espn-needs-reconnect')).toBeTruthy()
    expect(screen.getByText(/stopped accepting your saved connection/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update cookies' })).toBeTruthy()
  })

  it('stays hidden for a healthy connection', async () => {
    stubAuth({ needsReconnect: false })
    render(<EspnConnectPanel />)
    await screen.findByRole('button', { name: 'Update cookies' })
    expect(screen.queryByTestId('espn-needs-reconnect')).toBeNull()
  })
})
