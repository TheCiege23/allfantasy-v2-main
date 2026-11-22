/** A separate pick trade deadline — the Trade settings control and the Trade Center chip, in both languages. */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es', queuePatch: vi.fn() }))

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[h.language]?.[k] ?? dict.en[k] ?? k
  const tInterpolate = (k: string, vars: Record<string, string | number> = {}) => t(k).replace(/\{\{(\w+)\}\}/g, (_: string, v: string) => String(vars[v] ?? ''))
  return { useLanguage: () => ({ language: h.language, t }), useOptionalLanguage: () => ({ language: h.language, t, tInterpolate }) }
})
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({ useLeagueSettingsSectionAutosave: () => ({ queuePatch: h.queuePatch, saving: false }) }))

import { TradesTab } from '@/components/league-settings/tabs/TradesTab'
import { PickTradeDeadlineChip } from '@/components/core-app/TradeDeadlineCountdown'

const ctx = (league: Record<string, unknown> = {}) =>
  ({
    league: { id: 'L', sport: 'NFL', timezone: 'America/New_York', tradeReviewHours: 48, tradeDeadlineWeek: 11, draftPickTrading: true, leagueType: 'dynasty', settings: {}, ...league },
  }) as never

afterEach(() => {
  cleanup()
  h.queuePatch.mockReset()
  h.language = 'en'
})

describe('Trade settings', () => {
  it('a dynasty commissioner keeps pick trades open, or closes them after a week of their own', () => {
    render(<TradesTab ctx={ctx()} canEdit />)
    const mode = screen.getByTestId('pick-trade-deadline-mode') as HTMLSelectElement
    expect(mode.value).toBe('same')
    fireEvent.change(mode, { target: { value: 'open' } })
    expect(h.queuePatch).toHaveBeenLastCalledWith({ settingsMerge: { pick_trade_deadline: { mode: 'open' } } })
    fireEvent.change(mode, { target: { value: 'week' } })
    // Starts at the trade deadline's week.
    expect(h.queuePatch).toHaveBeenLastCalledWith({ settingsMerge: { pick_trade_deadline: { mode: 'week', week: 11 } } })
    fireEvent.change(screen.getByTestId('pick-trade-deadline-week'), { target: { value: '16' } })
    expect(h.queuePatch).toHaveBeenLastCalledWith({ settingsMerge: { pick_trade_deadline: { mode: 'week', week: 16 } } })
    fireEvent.change(mode, { target: { value: 'same' } })
    expect(h.queuePatch).toHaveBeenLastCalledWith({ settingsMerge: { pick_trade_deadline: { mode: 'same' } } })
  })

  it('shows the saved rule, read-only for a member', () => {
    render(<TradesTab ctx={ctx({ settings: { pick_trade_deadline: { mode: 'week', week: 15 } } })} canEdit={false} />)
    expect((screen.getByTestId('pick-trade-deadline-mode') as HTMLSelectElement).value).toBe('week')
    expect((screen.getByTestId('pick-trade-deadline-week') as HTMLInputElement).value).toBe('15')
    expect((screen.getByTestId('pick-trade-deadline-mode') as HTMLSelectElement).disabled).toBe(true)
  })

  it('a redraft league has no such control', () => {
    render(<TradesTab ctx={ctx({ leagueType: 'redraft' })} canEdit />)
    expect(screen.queryByTestId('pick-trade-deadline')).toBeNull()
  })

  it('in Spanish, with no «waiver»', () => {
    h.language = 'es'
    render(<TradesTab ctx={ctx()} canEdit />)
    const text = screen.getByTestId('pick-trade-deadline').textContent ?? ''
    expect(text).toContain(translations.es['lsHub.tr.pickDeadline'])
    expect(text).toContain(translations.es['lsHub.tr.pickDeadline.hint'])
    expect(text.toLowerCase()).not.toContain('waiver')
  })
})

describe('the Trade Center chip', () => {
  it('says the rule, or that pick trades closed, and nothing when they follow the deadline', () => {
    const { rerender, container } = render(<PickTradeDeadlineChip view={{ mode: 'open', week: null, passed: false }} />)
    expect(screen.getByTestId('pick-trade-deadline-chip').textContent).toBe('Pick trades open all season')
    rerender(<PickTradeDeadlineChip view={{ mode: 'week', week: 16, passed: false }} />)
    expect(screen.getByTestId('pick-trade-deadline-chip').textContent).toBe('Pick trades through Week 16')
    rerender(<PickTradeDeadlineChip view={{ mode: 'week', week: 16, passed: true }} />)
    expect(screen.getByTestId('pick-trade-deadline-chip').textContent).toBe('Pick trades closed')
    rerender(<PickTradeDeadlineChip view={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('in Spanish', () => {
    h.language = 'es'
    render(<PickTradeDeadlineChip view={{ mode: 'week', week: 16, passed: false }} />)
    expect(screen.getByTestId('pick-trade-deadline-chip').textContent).toBe('Intercambios de selecciones hasta la semana 16')
  })
})
