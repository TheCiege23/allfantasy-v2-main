/**
 * Tools launcher, restyled to the Tools board (2026-11-05): every card says where it stands against
 * the viewer's plan, the filter narrows by that, and a failed plan read draws neither the chip nor
 * the filter rather than calling a paying viewer Free.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ToolsHubData } from '@/lib/core-app/toolsHub'
import { matchesToolPlanFilter, toolPlanStatus } from '@/lib/core-app/toolsPlan'
import { expandPlansWithBundle } from '@/lib/subscription/feature-access'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import Tools from '@/components/core-app/screens/Tools'

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

const tool = (id: string, title: string, tier: 'free' | 'pro' | 'commissioner') => ({
  id, title, desc: `${title} body`, href: `/core/${id}`, live: null, tokenCost: null, tier,
})

const data = {
  groups: [
    { id: 'decide', heading: 'Decide something today', note: 'note', tools: [tool('waivers', 'Waiver Assistant', 'free'), tool('trade', 'Trade Analyzer', 'pro')] },
    { id: 'account', heading: 'Account', note: 'note', tools: [tool('commissioner', 'Commissioner Hub', 'commissioner')] },
  ],
  leagueScopedNote: 'scoped',
  openDecision: null,
} as unknown as ToolsHubData

describe('toolPlanStatus', () => {
  it('counts AF Supreme as AF Pro and AF Commissioner once the plans are expanded', () => {
    const held = expandPlansWithBundle(['supreme'])
    expect(toolPlanStatus('pro', held)).toBe('included')
    expect(toolPlanStatus('commissioner', held)).toBe('included')
  })

  it('a plan read that failed says nothing either way', () => {
    expect(toolPlanStatus('pro', null)).toBe('unknown')
    expect(matchesToolPlanFilter('unknown', 'upgrade')).toBe(false)
    expect(matchesToolPlanFilter('unknown', 'included')).toBe(false)
    expect(toolPlanStatus('free', null)).toBe('free')
  })
})

describe('Tools board', () => {
  it('badges each card against the plan and filters to what needs an upgrade', () => {
    render(<Tools data={data} viewerPlan={{ held: ['pro'], name: 'AF Pro' }} />)
    expect(screen.getByTestId('tools-plan-chip').textContent).toBe('Your plan · AF Pro')
    expect(within(screen.getByTestId('tool-waivers')).getByText('Free')).toBeTruthy()
    expect(within(screen.getByTestId('tool-trade')).getByText('Included')).toBeTruthy()
    expect(screen.getByTestId('tool-commissioner-plans').getAttribute('href')).toBe('/pricing')
    expect(screen.queryByTestId('tool-trade-plans')).toBeNull()

    fireEvent.click(screen.getByTestId('tools-filter-upgrade'))
    expect(screen.queryByTestId('tool-waivers')).toBeNull()
    expect(screen.queryByTestId('tool-trade')).toBeNull()
    expect(screen.getByTestId('tool-commissioner')).toBeTruthy()

    fireEvent.click(screen.getByTestId('tools-filter-included'))
    expect(screen.getByTestId('tool-trade')).toBeTruthy()
    expect(screen.queryByTestId('tool-commissioner')).toBeNull()
  })

  it('shows the empty state when no card matches', () => {
    render(<Tools data={data} viewerPlan={{ held: expandPlansWithBundle(['supreme']), name: 'AF Supreme' }} />)
    fireEvent.click(screen.getByTestId('tools-filter-upgrade'))
    expect(screen.getByText('No tools match this filter.')).toBeTruthy()
  })

  it('draws no plan chip and no filter when the plan read failed', () => {
    render(<Tools data={data} viewerPlan={null} />)
    expect(screen.queryByTestId('tools-plan-chip')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Filter tools' })).toBeNull()
    expect(screen.queryByTestId('tool-commissioner-plans')).toBeNull()
  })

  it('a free viewer reads Free on the chip, in Spanish too', () => {
    lang.language = 'es'
    render(<Tools data={data} viewerPlan={{ held: [], name: null }} />)
    expect(screen.getByTestId('tools-plan-chip').textContent).toBe('Tu plan · Gratis')
    expect(screen.getByRole('button', { name: 'Preguntar a Chimmy' })).toBeTruthy()
  })

  it('Ask Chimmy opens the Chimmy tab of the comms drawer', () => {
    const seen: unknown[] = []
    const onOpen = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener(COMMS_OPEN_EVENT, onOpen)
    render(<Tools data={data} viewerPlan={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask Chimmy' }))
    window.removeEventListener(COMMS_OPEN_EVENT, onOpen)
    expect(seen).toEqual([{ tab: 'chimmy' }])
  })
})
