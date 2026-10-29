/** The card's switches send each automation's own request (phase 11, 2026-10-29). */
import { describe, expect, it } from 'vitest'
import { automationToggleRequest, isToggleableAutomation } from '@/lib/commissioner-hub/automationToggles'

describe('automationToggleRequest', () => {
  it('goes to the endpoint each automation already uses', () => {
    expect(automationToggleRequest('L 1', 'fill_empty_starters', false)).toEqual({ url: '/api/leagues/L%201/fill-empty-starters', method: 'POST', body: { on: false } })
    expect(automationToggleRequest('L', 'auto_handover', true)).toEqual({ url: '/api/leagues/L/inactive-managers', method: 'POST', body: { autoHandover: { days: 14, to: 'lineups' } } })
    expect(automationToggleRequest('L', 'auto_handover', false).body).toEqual({ autoHandover: null })
    expect(automationToggleRequest('L', 'rookie_draft_opens', true)).toEqual({ url: '/api/leagues/L/dynasty-settings', method: 'PUT', body: { rookieDraftAutoOpen: true } })
    expect(automationToggleRequest('L', 'rookie_draft_starts', false).body).toEqual({ rookieDraftAutoStartDays: null })
  })

  it('only the free automations are switchable here', () => {
    expect(['fill_empty_starters', 'auto_handover', 'rookie_draft_opens', 'rookie_draft_starts'].every(isToggleableAutomation)).toBe(true)
    expect(['tanking', 'draft_as_me', 'ir_auto_move', 'taxi_rules', 'managed_teams'].some(isToggleableAutomation)).toBe(false)
  })
})
