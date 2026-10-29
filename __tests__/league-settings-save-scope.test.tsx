// @vitest-environment jsdom
/**
 * Every League Settings page saves the same way: edit, then "Save changes". The autosaving tabs
 * (General, Waivers, Trades, Playoffs, AI, Format) used to save as you typed with no button, so a
 * commissioner could not tell whether a change had taken. Inside <SettingsSaveScope> the shared hook
 * holds edits for the sticky save bar; outside it (the older modal) it still autosaves.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/lib/league-settings/savedLeagueOverrides', () => ({ recordSavedLeagueOverrides: vi.fn() }))

import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { SettingsSaveScope, confirmDiscardIfDirty, useSaveScopeHandleRef } from '@/components/league-settings/home/SettingsSaveScope'

function WaiverHoursField() {
  const { queuePatch } = useLeagueSettingsSectionAutosave('L1', 'waivers')
  return (
    <input
      aria-label="Waiver period"
      defaultValue="24"
      onChange={(e) => queuePatch({ waiverHours: Number(e.target.value) })}
    />
  )
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('inside a League Settings page', () => {
  it('holds edits until "Save changes", then saves them in one PATCH and says so', async () => {
    render(
      <SettingsSaveScope>
        <WaiverHoursField />
      </SettingsSaveScope>,
    )
    expect(screen.queryByTestId('lsh-savebar')).toBeNull()

    fireEvent.change(screen.getByLabelText('Waiver period'), { target: { value: '36' } })
    fireEvent.change(screen.getByLabelText('Waiver period'), { target: { value: '48' } })
    await new Promise((r) => setTimeout(r, 600)) // past the old 420ms autosave debounce
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('lsh-savebar').textContent).toContain('Unsaved changes')

    fireEvent.click(screen.getByTestId('lsh-save-changes'))
    await waitFor(() => expect(screen.getByTestId('lsh-savebar').textContent).toContain('✓ Saved'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/leagues/L1/settings')
    expect(JSON.parse(init.body)).toEqual({ section: 'waivers', updates: { waiverHours: 48 } })
  })

  it('Discard sends nothing and puts the field back', async () => {
    render(
      <SettingsSaveScope>
        <WaiverHoursField />
      </SettingsSaveScope>,
    )
    fireEvent.change(screen.getByLabelText('Waiver period'), { target: { value: '72' } })
    fireEvent.click(screen.getByTestId('lsh-discard'))
    await waitFor(() => expect(screen.queryByTestId('lsh-savebar')).toBeNull())
    expect((screen.getByLabelText('Waiver period') as HTMLInputElement).value).toBe('24')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the edits after a failed save so it can be tried again', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Settings are locked' }) })
    render(
      <SettingsSaveScope>
        <WaiverHoursField />
      </SettingsSaveScope>,
    )
    fireEvent.change(screen.getByLabelText('Waiver period'), { target: { value: '12' } })
    fireEvent.click(screen.getByTestId('lsh-save-changes'))
    await waitFor(() => expect(screen.getByTestId('lsh-savebar').textContent).toContain('did not save'))
    fireEvent.click(screen.getByTestId('lsh-save-changes'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).updates).toEqual({ waiverHours: 12 })
  })

  it('asks before leaving with unsaved changes', async () => {
    let handleRef: ReturnType<typeof useSaveScopeHandleRef>['ref'] | null = null
    function Page() {
      const h = useSaveScopeHandleRef()
      handleRef = h.ref
      return (
        <SettingsSaveScope onReady={h.onReady}>
          <WaiverHoursField />
        </SettingsSaveScope>
      )
    }
    render(<Page />)
    expect(confirmDiscardIfDirty(handleRef!.current)).toBe(true) // nothing changed: leave freely

    fireEvent.change(screen.getByLabelText('Waiver period'), { target: { value: '60' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    expect(confirmDiscardIfDirty(handleRef!.current)).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('outside a League Settings page (older modal)', () => {
  it('still autosaves after the debounce', async () => {
    vi.useFakeTimers()
    render(<WaiverHoursField />)
    fireEvent.change(screen.getByLabelText('Waiver period'), { target: { value: '30' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('lsh-savebar')).toBeNull()
  })
})
