import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ResponsiveDetails } from '@/components/core-app/ResponsiveDetails'
import AIWaiverRecommendationsPanel from '@/components/waivers/AIWaiverRecommendationsPanel'
import { Waivers } from '@/components/core-app/screens/Waivers'
import type { WaiversData } from '@/lib/core-app/waivers'

/**
 * The 2026-10-02 Waivers layout: the rules fold on a narrow page, Chimmy's panel wears the core
 * skin (so it is legible on the light theme, and shows no control that does nothing), and the
 * screen's DOM order is the phone order — tiles, then the actions, then the reference.
 */

const scoped = (width: number, child: React.ReactNode) => {
  /* jsdom has no layout: give the scope the width the component measures. */
  const ref = (el: HTMLDivElement | null) => {
    if (el) Object.defineProperty(el, 'clientWidth', { configurable: true, value: width })
  }
  return (
    <div data-details-scope ref={ref}>
      {child}
    </div>
  )
}

describe('ResponsiveDetails', () => {
  it('folds itself on a narrow page', async () => {
    render(scoped(375, <ResponsiveDetails summary="Rules" testId="d">body</ResponsiveDetails>))
    await waitFor(() => expect((screen.getByTestId('d') as HTMLDetailsElement).open).toBe(false))
  })
  it('stays open where there is room — and starts open, so a wide page never jumps', () => {
    render(scoped(1100, <ResponsiveDetails summary="Rules" testId="d">body</ResponsiveDetails>))
    expect((screen.getByTestId('d') as HTMLDetailsElement).open).toBe(true)
  })
})

describe('AIWaiverRecommendationsPanel skins', () => {
  afterEach(() => vi.unstubAllGlobals())

  const withResults = async (surface?: 'core') => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        recommendations: [{ priority: 1, addPlayerId: '1', addPlayerName: 'A', confidence: 'high', risk: 'low', reasoning: 'r' }],
        generatedAt: null,
      }),
    })) as never)
    render(<AIWaiverRecommendationsPanel leagueId="L" {...(surface ? { surface } : {})} />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    await screen.findByTestId('ai-waiver-recommendations-results')
  }

  it('core: the screen’s own card and tokens, no hard-coded dark palette, and no dead reminder checkbox', async () => {
    await withResults('core')
    const panel = screen.getByTestId('ai-waiver-recommendations-panel')
    expect(panel.className).toContain('af-card')
    expect(panel.innerHTML).not.toMatch(/text-white|bg-sky-500/)
    expect(screen.queryByTestId('waiver-reminder-placeholder')).toBeNull()
  })

  it('default: the /waiver-wire skin is unchanged, placeholder included', async () => {
    await withResults()
    const panel = screen.getByTestId('ai-waiver-recommendations-panel')
    expect(panel.className).toBe('rounded-xl border border-sky-400/25 bg-sky-500/5 p-4')
    expect(screen.getByTestId('waiver-reminder-placeholder')).toBeTruthy()
  })
})

describe('Waivers screen layout', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('puts the tiles, then the actions, then the rules — the phone order', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as never)
    const data: WaiversData = {
      league: { id: 'L1', name: 'Dynasty Dragons', platform: 'manual', format: null, platformLeagueId: null },
      budget: { available: false, reason: 'x' },
      waiverPriority: { available: false, reason: 'x' },
      rosterLoad: { available: false, reason: 'x' },
      claimsQueued: { available: false, reason: 'x' },
      waiverType: { available: true, data: { kind: 'rolling', label: 'Rolling waiver priority', budget: null } },
      processTime: { available: true, data: { dayOfWeek: 3, dayLabel: 'Wednesday', timeUtc: '09:00' } },
      tiebreak: { available: true, data: 'Waiver priority order' },
      claimLimits: { available: false, reason: 'x' },
    }
    const { container } = render(<Waivers data={data} edge={null} edgeAccess={null} />)
    const order = [...container.querySelectorAll('.af-wv-area-tiles, [data-testid="waiver-lineup-board-loading"], [data-testid="waiver-rules"]')]
      .map((e) => (e.matches('.af-wv-area-tiles') ? 'tiles' : e.matches('[data-testid="waiver-rules"]') ? 'rules' : 'actions'))
    expect(order).toEqual(['tiles', 'actions', 'rules'])
    /* The folded rules still say the two facts people check most. */
    expect(screen.getByTestId('waiver-rules').querySelector('summary')?.textContent).toContain('Rolling waiver priority · Wednesday')
  })
})
