import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MergedDevyC2CCommissionerSettings } from '@/components/merged-devy-c2c/MergedDevyC2CCommissionerSettings'

const initial = {
  leagueId: 'l1', sport: 'NBA', startupFormat: 'merged', mergedStartupDraft: true, separateStartupCollegeDraft: false,
  collegeRosterSize: 15, collegeActiveLineupSlots: { G: 2, F: 2, C: 1, FLEX: 2 }, taxiSize: 4,
  rookieDraftRounds: 3, collegeDraftRounds: 5, bestBallPro: true, bestBallCollege: true,
  standingsModel: 'unified', mergedRookieCollegeDraft: false, nflCollegeExcludeKDST: false,
  promotionTiming: 'manager_choice_before_rookie_draft', maxPromotionsPerYear: null,
  earlyDeclareBehavior: 'allow', returnToSchoolHandling: 'restore_rights', rookiePickTradeRules: 'allowed',
  collegePickTradeRules: 'allowed', collegeScoringUntilDeadline: true, proBenchSize: 10, proIRSize: 3,
  startupDraftType: 'snake', rookieDraftType: 'snake', collegeDraftType: 'snake',
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup() {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true, json: async () => ({ config: init?.body ? { ...initial, ...JSON.parse(String(init.body)) } : initial }),
  }))
  vi.stubGlobal('fetch', fetcher)
  render(<MergedDevyC2CCommissionerSettings leagueId="l1" />)
  return fetcher
}

describe('C2C commissioner editor', () => {
  it('saves college slots including zero', async () => {
    const fetcher = setup()
    const guard = await screen.findByLabelText('G')
    fireEvent.change(guard, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save college lineup' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ collegeActiveLineupSlots: { G: 0, F: 2, C: 1, FLEX: 2 } })
  })
  it('saves a synchronized startup format and draft flags', async () => {
    const fetcher = setup()
    fireEvent.change(await screen.findByLabelText('Startup format'), { target: { value: 'separate' } })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ startupFormat: 'separate', mergedStartupDraft: false, separateStartupCollegeDraft: true })
  })
  it('saves a zero promotion cap', async () => {
    const fetcher = setup()
    const input = await screen.findByLabelText(/Maximum promotions per team/)
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ maxPromotionsPerYear: 0 })
  })
})

