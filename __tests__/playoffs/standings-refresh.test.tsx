import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
/* Background refreshes go through the deploy guard (lib/core-app/deployGuard). A synchronous
   pass-through keeps fake-timer assertions in the same tick; guard.ok=false is "a deploy landed". */
const guard = vi.hoisted(() => ({ ok: true }))
vi.mock('@/lib/core-app/deployGuard', () => ({
  primeDeployBaseline: () => Promise.resolve(),
  canRefreshInBackground: () => ({ then: (cb: (ok: boolean) => void) => cb(guard.ok) }),
  refreshInBackground: (fn: () => void) => { if (guard.ok) fn(); return Promise.resolve() },
}))
import RefreshBracketStandings from '@/components/brackets/RefreshBracketStandings'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); refresh.mockClear() })

describe('universal standings refresh', () => {
  it('refreshes while visible and stops on unmount', () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const result = render(<RefreshBracketStandings />)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(refresh).toHaveBeenCalledTimes(1)
    result.unmount()
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
