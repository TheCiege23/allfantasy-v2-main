import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/*
 * Owner report 2026-09-25: "the whole page resets when I try to type sometimes". next-auth re-checks
 * the session whenever the tab becomes visible again, and any failed check reports `null` until the
 * next one. The drawer was keyed on the live user id, so a blip rebuilt it: tab back to Chimmy,
 * league scope cleared, the half-typed message gone. Reproduced in Chromium first; this pins it.
 */

const auth = vi.hoisted(() => {
  type S = { user: { id: string } } | null
  let session: S = { user: { id: 'me' } }
  const subs = new Set<() => void>()
  return {
    get: () => session,
    set: (s: S) => {
      session = s
      subs.forEach((f) => f())
    },
    subscribe: (f: () => void) => {
      subs.add(f)
      return () => subs.delete(f)
    },
  }
})

vi.mock('next-auth/react', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSession: () => {
      const data = useSyncExternalStore(auth.subscribe, auth.get)
      return { data, status: data ? 'authenticated' : 'unauthenticated' }
    },
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import CommsDock from '@/components/core-app/comms/CommsDock'
import CommsDrawer from '@/components/core-app/comms/CommsDrawer'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { writeCommsUi } from '@/components/core-app/comms/commsUiMemory'

const leagues = [
  { id: 'L1', name: 'KBFL', platform: 'sleeper', isCommissioner: true, teamCount: 12, platformLeagueId: '1' },
  { id: 'L2', name: 'AFC Dreaming!', platform: 'sleeper', isCommissioner: false, teamCount: 10, platformLeagueId: '2' },
]

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }))
  auth.set({ user: { id: 'me' } })
  vi.stubGlobal('fetch', vi.fn(async () => json({ messages: [], threads: [], turns: [] })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function openDockInLeague(leagueId: string) {
  render(
    <CommsDock
      leagues={leagues as never}
      pageLeagueId={null}
      chimmyTokenCost={10}
      chimmyPlanAllowance={null}
      homeSignals={null}
      pageSurface={null}
      dockable={false}
      supportEmail=""
      unread={0}
      mentions={0}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Open communications/ }))
  fireEvent.click(screen.getByRole('tab', { name: /League/ }))
  fireEvent.change(screen.getByRole('combobox', { name: 'League scope' }), { target: { value: leagueId } })
}

const activeTab = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent
const scope = () => (screen.getByRole('combobox', { name: 'League scope' }) as HTMLSelectElement).value
const composer = () => document.querySelector('.af-cm textarea') as HTMLTextAreaElement

describe('the chat drawer through a session re-check blip', () => {
  it('🛑 keeps the tab, the league and what you typed when next-auth briefly reports nobody', () => {
    openDockInLeague('L2')
    fireEvent.change(composer(), { target: { value: 'hello league' } })
    expect(activeTab()).toMatch(/League/)

    act(() => auth.set(null)) // the re-check failed
    act(() => auth.set({ user: { id: 'me' } })) // and recovered

    expect(activeTab()).toMatch(/League/)
    expect(scope()).toBe('L2')
    expect(composer().value).toBe('hello league')
  })

  it('still starts fresh when a DIFFERENT person signs in — one account never sees another\'s chat', () => {
    openDockInLeague('L2')
    fireEvent.change(composer(), { target: { value: 'private to me' } })

    act(() => auth.set({ user: { id: 'someone-else' } }))

    expect(document.querySelector('.af-cm textarea')?.textContent ?? '').not.toContain('private to me')
    expect((document.querySelector('.af-cm textarea') as HTMLTextAreaElement | null)?.value ?? '').not.toBe('private to me')
  })
})

/*
 * "The chat bubble closes … and doesn't come back": /core's loading boundary replaces the whole shell
 * on every screen change, so CommsDock unmounts and mounts fresh. Unmount + render is that navigation.
 */
function renderDock(pageLeagueId: string | null = null) {
  return render(
    <CommsDock
      leagues={leagues as never}
      pageLeagueId={pageLeagueId}
      chimmyTokenCost={10}
      chimmyPlanAllowance={null}
      homeSignals={null}
      pageSurface={null}
      dockable={false}
      supportEmail=""
      unread={0}
      mentions={0}
    />,
  )
}

describe('the chat across a /core navigation', () => {
  it('🛑 comes back open, on the same tab and league, after the page replaces it', () => {
    const first = renderDock()
    fireEvent.click(screen.getByRole('button', { name: /Open communications/ }))
    fireEvent.click(screen.getByRole('tab', { name: /League/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'League scope' }), { target: { value: 'L2' } })
    first.unmount() // the loading boundary swaps the shell out

    renderDock()
    expect(document.querySelector('.af-cm')).not.toBeNull()
    expect(activeTab()).toMatch(/League/)
    expect(scope()).toBe('L2')
  })

  it('a closed chat stays closed', () => {
    const first = renderDock()
    fireEvent.click(screen.getByRole('button', { name: /Open communications/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    first.unmount()

    renderDock()
    expect(document.querySelector('.af-cm')).toBeNull()
    expect(screen.getByRole('button', { name: /Open communications/ })).toBeTruthy()
  })

  it('moving to another league\'s page follows that page\'s league, not the remembered one', () => {
    const first = renderDock('L1')
    fireEvent.click(screen.getByRole('button', { name: /Open communications/ }))
    fireEvent.click(screen.getByRole('tab', { name: /League/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'League scope' }), { target: { value: 'L2' } })
    first.unmount()

    renderDock('L1') // same page league: the hand-picked league stands
    expect(scope()).toBe('L2')
    cleanup()

    renderDock('L2') // a different league's page
    expect(activeTab()).toMatch(/League/)
    expect(scope()).toBe('L2')
    cleanup()

    renderDock('L1') // back on L1's page after L2's: the page moved, so L1
    expect(scope()).toBe('L1')
  })

  it('a request for a specific tab beats the remembered one', () => {
    const first = renderDock()
    fireEvent.click(screen.getByRole('button', { name: /Open communications/ }))
    fireEvent.click(screen.getByRole('tab', { name: /League/ }))
    first.unmount()

    renderDock()
    expect(activeTab()).toMatch(/League/)
    act(() => {
      window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab: 'chimmy' } }))
    })
    expect(activeTab()).toMatch(/Chimmy/)
  })

  it('never restores one account\'s chat for another', () => {
    const first = renderDock()
    fireEvent.click(screen.getByRole('button', { name: /Open communications/ }))
    fireEvent.click(screen.getByRole('tab', { name: /League/ }))
    first.unmount()

    auth.set({ user: { id: 'someone-else' } })
    renderDock()
    expect(document.querySelector('.af-cm')).toBeNull()
  })

  it('still works when the browser blocks storage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderDock()
    fireEvent.click(screen.getByRole('button', { name: /Open communications/ }))
    expect(document.querySelector('.af-cm')).not.toBeNull()
    getItem.mockRestore()
    setItem.mockRestore()
  })
})

describe('only the chat bubble goes back to where you were', () => {
  function drawer(props: Partial<React.ComponentProps<typeof CommsDrawer>>) {
    return render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={leagues as never}
        pageLeagueId={null}
        chimmyTokenCost={10}
        userId="me"
        {...props}
      />,
    )
  }

  it('a drawer opened on a tab opens on THAT tab, whatever was remembered', () => {
    writeCommsUi('me', { tab: 'chimmy', scopeId: 'L2', pageLeagueId: null })
    drawer({ initialTab: 'league' })
    expect(activeTab()).toMatch(/League/)
    expect(scope()).not.toBe('L2')
  })

  it('an open request made as the bubble mounts beats the remembered tab', () => {
    writeCommsUi('me', { tab: 'league', scopeId: null, pageLeagueId: null })
    drawer({ rememberPlace: true, openRequest: { seq: 1, tab: 'chimmy', leagueId: null } })
    expect(activeTab()).toMatch(/Chimmy/)
  })
})

/*
 * Under /core the dock now OUTLIVES the shell (CommsDockHost), so a docked drawer that marked the
 * old `.af-shell` must mark the new one when a screen change swaps it — or the new page slides back
 * under the drawer. `shellKey` is what tells it the element changed.
 */
describe('a docked drawer across a shell swap', () => {
  it('re-marks the new .af-shell with data-comms-docked', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }))
    const shellA = document.createElement('div')
    shellA.className = 'af-shell'
    document.body.appendChild(shellA)
    const dockProps = {
      leagues: leagues as never,
      pageLeagueId: 'L1',
      chimmyTokenCost: 10,
      dockable: true,
    }
    const view = render(<CommsDock {...dockProps} shellKey="A" />)
    fireEvent.click(screen.getByRole('button', { name: /Open communications/ }))
    expect(shellA.getAttribute('data-comms-docked')).toBe('true')

    /* The screen change: the old shell leaves, a new one arrives, the dock stays. */
    shellA.remove()
    const shellB = document.createElement('div')
    shellB.className = 'af-shell'
    document.body.appendChild(shellB)
    view.rerender(<CommsDock {...dockProps} shellKey="B" />)

    expect(shellB.getAttribute('data-comms-docked')).toBe('true')
    shellB.remove()
  })
})
