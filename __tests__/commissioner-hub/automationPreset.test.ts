/** Automation presets (phase 10, 2026-10-29): one choice instead of ten cards. */
import { describe, expect, it } from 'vitest'
import { planAutomationPreset, type PresetFacts } from '@/lib/commissioner-hub/automationPreset'

const facts = (over: Partial<PresetFacts> = {}): PresetFacts => ({
  settings: {},
  dynasty: true,
  commissionerPlan: true,
  rookieDraftAutoOpen: false,
  liveRookieOrderOn: false,
  tankingMonitorOn: false,
  ...over,
})
const keys = (plan: ReturnType<typeof planAutomationPreset>) => plan.changes.map((c) => c.step.key)

describe('planAutomationPreset', () => {
  it('recommended switches on everything that keeps a league running, and nothing already on', () => {
    // Fill-empty and draft-as-me are on by default: nothing to change for them.
    expect(keys(planAutomationPreset('recommended', facts()))).toEqual([
      'eliminated_lineups', 'ir_auto_move', 'tanking_monitor', 'rookie_draft_opens', 'rookie_draft_starts', 'live_rookie_order',
    ])
  })

  it('never touches taxi rules or held trades', () => {
    const all = [...keys(planAutomationPreset('recommended', facts())), ...keys(planAutomationPreset('run_it', facts()))] as string[]
    expect(all).not.toContain('taxi_rules')
    expect(all).not.toContain('hold_flagged_trades')
  })

  it('run it for me adds the 14-day handover, to Chimmy with the plan and to AllFantasy without', () => {
    const withPlan = planAutomationPreset('run_it', facts()).changes.find((c) => c.step.key === 'auto_handover')!
    expect(withPlan.step).toEqual({ key: 'auto_handover', rule: { days: 14, to: 'autopilot' } })
    const without = planAutomationPreset('run_it', facts({ commissionerPlan: false })).changes.find((c) => c.step.key === 'auto_handover')!
    expect(without.step).toEqual({ key: 'auto_handover', rule: { days: 14, to: 'lineups' } })
  })

  it('without AF Commissioner, the paid automations are listed as needing it and not changed', () => {
    const plan = planAutomationPreset('recommended', facts({ commissionerPlan: false }))
    expect(keys(plan)).toEqual(['rookie_draft_opens', 'rookie_draft_starts'])
    expect(plan.needsPlan).toEqual([
      'Missed picks made the way the manager drafts', 'Lineup minimums for eliminated teams', 'Move healthy players off IR', 'Anti-tanking monitor', 'Rookie draft order kept up to date',
    ])
  })

  it('a redraft league gets no rookie-draft steps', () => {
    expect(keys(planAutomationPreset('recommended', facts({ dynasty: false })))).toEqual(['eliminated_lineups', 'ir_auto_move', 'tanking_monitor'])
  })

  it('hands on turns off filling and handover only', () => {
    const plan = planAutomationPreset('hands_on', facts({ settings: { inactive_auto_handover: { days: 7, to: 'lineups', since: '2026-10-01T00:00:00.000Z', byUserId: 'c' } } }))
    expect(plan.changes.map((c) => c.step)).toEqual([{ key: 'fill_empty_starters', on: false }, { key: 'auto_handover', rule: null }])
  })

  it('applying twice changes nothing the second time', () => {
    const settings = {
      eliminated_lineup_minimum: { enabled: true, standard: 'playable', autoFill: true },
      ir_auto_move: { enabled: true },
      dynasty_rookie_draft_calendar: { autoOpen: true, autoStartDays: 7 },
    }
    expect(planAutomationPreset('recommended', facts({ settings, rookieDraftAutoOpen: true, liveRookieOrderOn: true, tankingMonitorOn: true })).changes).toEqual([])
  })
})
