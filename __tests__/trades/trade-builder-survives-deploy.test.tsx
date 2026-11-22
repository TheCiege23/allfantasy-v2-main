import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 "WHEN I WENT TO PUT IN THE ASSETS FOR BOTH TEAMS, THE PAGE REFRESHED AND I HAD TO START ALL
 * OVER AGAIN" (2026-11-19, /core/trades). After a deploy, NewVersionReload reloads a page the
 * moment it goes into the background. It already spared typed text and music, but a trade built by
 * tapping is neither, so checking another app mid-trade threw the trade away. Deploys landed about
 * every 20 minutes that day.
 *
 * Drives the REAL builder and the REAL reload component together: a test of either alone cannot
 * see that the builder's state never reached the reload's decision.
 */

const guard = vi.hoisted(() => ({ ready: false, listeners: new Set<() => void>() }))
vi.mock('@/lib/core-app/deployGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/deployGuard')>()),
  isNewVersionReady: () => guard.ready,
  subscribeNewVersionReady: (fn: () => void) => {
    guard.listeners.add(fn)
    return () => guard.listeners.delete(fn)
  },
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/core/trades',
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

const rosterData = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/components/core-app/screens/useLeagueRosters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/core-app/screens/useLeagueRosters')>()),
  useLeagueRosters: () => ({ data: rosterData.current, state: 'idle' }),
}))

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'
import { NewVersionReload } from '@/components/shell/NewVersionReload'

const LEAGUE = { id: 'l1', name: 'Draft Junkies', format: 'Dynasty · PPR', teamCount: 12 }
const player = (id: string, name: string) => ({
  id, name, position: 'WR', team: 'PIT', value: 1976, imageUrl: null, byeWeek: null,
  injuryStatus: null, stock: null, stockDelta: null,
})
const roster = (rosterId: string, ownerName: string, players: unknown[]) => ({
  rosterId, platformUserId: `u-${rosterId}`, players, picks: [], teamExternalId: `t-${rosterId}`,
  ownerName, avatarUrl: null, wins: 0, losses: 0, ties: 0, faabRemaining: null,
})

const reload = vi.fn()
const realLocation = window.location
const setVisibility = (state: 'visible' | 'hidden') =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
const deployLands = () => {
  guard.ready = true
  act(() => { for (const fn of guard.listeners) fn() })
}
const switchAway = () => {
  setVisibility('hidden')
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}
const comeBack = () => {
  setVisibility('visible')
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

beforeEach(() => {
  guard.ready = false
  guard.listeners.clear()
  reload.mockClear()
  setVisibility('visible')
  window.localStorage.clear()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
  rosterData.current = {
    rosters: [roster('r1', 'You', [player('p1', 'DK Metcalf')]), roster('r2', 'Matt Jones', [player('p9', 'Christian McCaffrey')])],
    viewerRosterId: 'r1',
    viewerTeamRosterId: 'r1',
  }
})
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

function Page() {
  return (
    <>
      <NewVersionReload />
      <TradeCenter league={LEAGUE} />
    </>
  )
}

describe('a trade being built survives a deploy', () => {
  it('🛑 switching to another app mid-trade does not reload the page', () => {
    render(<Page />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    deployLands()
    switchAway()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads in the background again once the builder is empty', () => {
    const { container } = render(<Page />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    deployLands()
    switchAway()
    comeBack()
    fireEvent.click(container.querySelector('.af-tc-remove')!)
    switchAway()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: with nothing in the builder, a deploy still reloads in the background', () => {
    render(<Page />)
    deployLands()
    switchAway()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
