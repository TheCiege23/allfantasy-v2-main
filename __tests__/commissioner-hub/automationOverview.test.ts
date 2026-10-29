/** "What runs itself": every automation, its state, and where its switch is (phase 9, 2026-10-29). */
import { describe, expect, it } from 'vitest'
import { buildAutomationOverview, type AutomationFacts } from '@/lib/commissioner-hub/automationOverview'

const facts = (over: Partial<AutomationFacts> = {}): AutomationFacts => ({
  leagueId: 'L1',
  settings: {},
  dynasty: true,
  commissionerPlan: true,
  rookieDraftAutoOpen: true,
  liveRookieOrderOn: false,
  tankingMonitorOn: true,
  tankingPenaltiesOn: true,
  holdFlaggedTradesMode: 'severe',
  ...over,
})
const row = (rows: ReturnType<typeof buildAutomationOverview>, key: string) => rows.find((r) => r.key === key)!

describe('buildAutomationOverview', () => {
  it('reads each switch from the league settings', () => {
    const rows = buildAutomationOverview(facts({
      settings: {
        fill_empty_starters: false,
        af_managed_lineups: { r1: { since: 's', byUserId: 'c' }, r2: { since: 's', byUserId: 'c', autopilot: { style: 'win_now', since: 's', byUserId: 'c' } } },
        eliminated_lineup_minimum: { enabled: true, standard: 'playable', autoFill: true },
        dynasty_rookie_draft_calendar: { autoStartDays: 7 },
        taxi_rules_enforced: true,
      },
    }))
    expect(row(rows, 'fill_empty_starters')).toMatchObject({ state: 'off', href: '#ch-fill-empty-starters' })
    expect(row(rows, 'managed_teams')).toMatchObject({ state: 'on', detail: '2 teams, 1 on Chimmy autopilot' })
    expect(row(rows, 'eliminated_lineups')).toMatchObject({ state: 'on', detail: 'Short spots filled from the bench' })
    expect(row(rows, 'rookie_draft_starts')).toMatchObject({ state: 'on', detail: '7 days after it opens', href: '/league/L1?view=settings' })
    expect(row(rows, 'taxi_rules')).toMatchObject({ state: 'on' })
    expect(row(rows, 'tanking')).toMatchObject({ state: 'on', detail: 'Warning, then the penalty you chose', href: '/league/L1/commissioner/integrity' })
    expect(row(rows, 'hold_flagged_trades')).toMatchObject({ state: 'on', detail: 'Serious flags only' })
  })

  it('defaults: fill empty spots on, nothing managed, the rookie draft does not start itself', () => {
    const rows = buildAutomationOverview(facts())
    expect(row(rows, 'fill_empty_starters').state).toBe('on')
    expect(row(rows, 'managed_teams').state).toBe('off')
    expect(row(rows, 'rookie_draft_starts').state).toBe('off')
  })

  it('without AF Commissioner, the paid automations say so instead of claiming to run', () => {
    const rows = buildAutomationOverview(facts({ commissionerPlan: false, settings: { taxi_rules_enforced: true } }))
    for (const key of ['eliminated_lineups', 'ir_auto_move', 'draft_as_me', 'live_rookie_order', 'tanking', 'hold_flagged_trades', 'taxi_rules']) {
      expect(row(rows, key).state).toBe('needs_plan')
    }
    // Free ones are unaffected.
    expect(row(rows, 'fill_empty_starters').state).toBe('on')
  })

  it('a non-dynasty league is not shown the rookie draft or taxi rows', () => {
    const keys = buildAutomationOverview(facts({ dynasty: false })).map((r) => r.key)
    expect(keys).not.toContain('rookie_draft_opens')
    expect(keys).not.toContain('taxi_rules')
    expect(keys).toContain('tanking')
  })
})
