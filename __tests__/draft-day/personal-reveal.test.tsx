import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DraftDayShow } from '@/components/draft-day/DraftDayShow'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('personal draft reveal', () => {
  it('waits for the shared reveal before showing the viewer’s pick', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-10-31T18:00:00.000Z')
    vi.setSystemTime(now)
    const show = {
      v: 1, sessionId: 'd1', kind: 'lottery', pace: 'standard', startedAt: new Date(now.getTime() - 5000).toISOString(), startedBy: 'u1',
      entries: [
        { slot: 2, rosterId: 'other', displayName: 'Other team', oddsPct: 60, preLotterySlot: 1 },
        { slot: 1, rosterId: 'mine', displayName: 'My team', oddsPct: 40, preLotterySlot: 2 },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ serverNow: now.toISOString(), show }) })))
    await act(async () => { render(<DraftDayShow leagueId="league" sessionStatus="pre_draft" viewerRosterId="mine" />) })
    expect(screen.getByText('Your team is waiting to be revealed')).toBeTruthy()
    expect(screen.queryByText('Your team · Pick 1')).toBeNull()
    expect(screen.queryByText('My team')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(4000) })
    expect(screen.getByText('Your team · Pick 1')).toBeTruthy()
    expect(screen.getByText('My team')).toBeTruthy()
    expect(screen.getAllByText('40% odds at #1 · Jumped 1 from odds rank 2').length).toBeGreaterThan(0)
  })
})
