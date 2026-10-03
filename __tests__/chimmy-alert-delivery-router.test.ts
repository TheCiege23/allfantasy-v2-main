import { describe, expect, it } from 'vitest'
import { routeAlertDelivery } from '@/lib/chimmy-alerts/ChimmyAlertDeliveryRouter'
import type { ChimmyAlert, ChimmyAlertContext } from '@/lib/chimmy-alerts/types'

function baseContext(overrides?: Partial<ChimmyAlertContext>): ChimmyAlertContext {
  return {
    userId: 'user-1',
    role: 'member',
    sport: 'NFL',
    leagueType: 'redraft',
    leagueId: 'league-1',
    pageSurface: 'dashboard',
    subscriptionState: {
      hasPremium: true,
      hasCommissioner: false,
      hasAdmin: false,
    },
    ...(overrides ?? {}),
  }
}

function baseAlert(overrides?: Partial<ChimmyAlert>): ChimmyAlert {
  return {
    alertId: 'alert-1',
    dedupeKey: 'dedupe-1',
    class: 'lineup',
    type: 'lineup_incomplete',
    title: 'Lineup not set',
    message: 'You still have empty starter slots.',
    severity: 'urgent',
    confidenceScore: 92,
    urgencyScore: 88,
    channels: ['dashboard_card'],
    primaryChannel: 'dashboard_card',
    dismissible: true,
    snoozable: true,
    repeatable: true,
    repeatCooldownMinutes: 120,
    roleScope: 'member',
    actions: [{ label: 'Set Lineup', href: '/leagues/league-1/lineup' }],
    ...(overrides ?? {}),
  }
}

describe('chimmy alert delivery router', () => {
  it('routes lineup alert to in-app banner + dashboard + push', () => {
    const plan = routeAlertDelivery(
      baseAlert({ type: 'lineup_incomplete', class: 'lineup', urgencyScore: 90, severity: 'urgent' }),
      baseContext({ pageSurface: 'dashboard' }),
    )

    expect(plan.surfaces).toContain('in_app_banner')
    expect(plan.surfaces).toContain('dashboard_card')
    expect(plan.transportChannels).toContain('push_notification')
  })

  it('routes weekly recap to dashboard or commissioner panel without push', () => {
    const commissionerPlan = routeAlertDelivery(
      baseAlert({
        class: 'commissioner',
        type: 'weekly_recap_ready',
        roleScope: 'commissioner',
        severity: 'action_recommended',
        urgencyScore: 62,
      }),
      baseContext({ role: 'commissioner' }),
    )

    expect(commissionerPlan.surfaces).toContain('commissioner_panel')
    expect(commissionerPlan.transportChannels).not.toContain('push_notification')
  })

  it('routes on-the-clock alerts to critical drawer + push', () => {
    const plan = routeAlertDelivery(
      baseAlert({
        class: 'draft',
        type: 'on_the_clock',
        severity: 'critical',
        urgencyScore: 99,
      }),
      baseContext({ pageSurface: 'draft_room' }),
    )

    expect(plan.surfaces).toContain('critical_drawer')
    expect(plan.transportChannels).toContain('push_notification')
  })

  it('routes waiver opportunities to dashboard + inline surfaces', () => {
    const plan = routeAlertDelivery(
      baseAlert({
        class: 'waiver',
        type: 'priority_add_available',
        severity: 'action_recommended',
        urgencyScore: 75,
      }),
      baseContext({ pageSurface: 'waiver' }),
    )

    expect(plan.surfaces).toContain('dashboard_card')
    expect(plan.surfaces).toContain('page_inline')
  })

  it('routes suspicious trade alerts to commissioner panel only', () => {
    const plan = routeAlertDelivery(
      baseAlert({
        class: 'commissioner',
        type: 'suspicious_trade_signal',
        roleScope: 'commissioner',
        severity: 'urgent',
        urgencyScore: 86,
      }),
      baseContext({ role: 'commissioner', pageSurface: 'commissioner_panel' }),
    )

    expect(plan.surfaces).toEqual(['commissioner_panel'])
    expect(plan.transportChannels).toContain('push_notification')
  })

  it('suppresses recently dismissed non-critical alerts', () => {
    const plan = routeAlertDelivery(
      baseAlert({ severity: 'action_recommended', urgencyScore: 65 }),
      baseContext(),
      { lastDismissedAt: new Date(Date.now() - 1000 * 60 * 30) },
    )

    expect(plan.shouldDeliver).toBe(false)
    expect(plan.reason).toBe('dismissed_recently')
  })
})

/**
 * Quiet hours are evaluated in the WINDOW'S timezone (2026-10-02). The router read `now.getHours()`
 * — the server's hour — so a window was shifted by the server's offset.
 *
 * The instant is chosen so the old rule is wrong on BOTH a UTC server (CI, Railway) and a
 * New-York-local machine: 17:00Z is 02:00 in Tokyo (inside 22→7) but 17:00 UTC and 13:00 New York
 * (outside). Asserting at an hour where the zones agree would pass with the bug in place.
 */
describe('chimmy alert quiet hours use the window timezone', () => {
  const lineupAlert = () => baseAlert({ type: 'lineup_incomplete', class: 'lineup', urgencyScore: 90, severity: 'urgent' })
  const at = (iso: string) =>
    baseContext({
      now: new Date(iso),
      userPreferences: { quietHours: { startHour: 22, endHour: 7, timezone: 'Asia/Tokyo' } },
    } as Partial<ChimmyAlertContext>)

  it("holds push inside the window, in the window's zone", () => {
    const plan = routeAlertDelivery(lineupAlert(), at('2026-10-02T17:00:00Z')) // 02:00 Tokyo
    expect(plan.transportChannels).not.toContain('push_notification')
  })

  it("CONTROL: sends push outside the window, in the window's zone", () => {
    const plan = routeAlertDelivery(lineupAlert(), at('2026-10-02T03:00:00Z')) // 12:00 Tokyo
    expect(plan.transportChannels).toContain('push_notification')
  })
})
