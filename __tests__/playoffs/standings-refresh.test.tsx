import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
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
