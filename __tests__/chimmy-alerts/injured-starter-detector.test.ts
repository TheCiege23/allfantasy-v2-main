import { describe, expect, it } from 'vitest'

import { detectInjuredStarterAlerts } from '@/lib/chimmy-alerts/ChimmyAlertDetectors'
import type { ChimmyAlertContext, InjuredStarterSignal } from '@/lib/chimmy-alerts/types'

const NOW = new Date('2026-09-13T16:05:00Z') // Sunday 12:05pm ET

function ctx(injured: InjuredStarterSignal[], lockAt: string | null = '2026-09-13T17:00:00Z'): ChimmyAlertContext {
  return {
    now: NOW,
    signalBundle: { injuredStarters: injured, lineupLockAt: lockAt },
  } as unknown as ChimmyAlertContext
}

const OUT_STARTER: InjuredStarterSignal = {
  playerName: 'Test Starter',
  position: 'RB',
  designation: 'Out',
  leagueId: 'lg-1',
  leagueName: 'The Last IDP Dynasty!!',
  platform: 'Sleeper',
  replacement: { playerName: 'Bench Guy', projectedPoints: 11.4 },
}

describe('detectInjuredStarterAlerts', () => {
  it('fires the Sunday-panic case: OUT starter, 55 minutes to lock', () => {
    const alerts = detectInjuredStarterAlerts(ctx([OUT_STARTER]))
    expect(alerts).toHaveLength(1)
    const a = alerts[0]!
    expect(a.type).toBe('injured_starter_before_lock')
    // Inside the hour, this must outrank everything else the engine produces.
    expect(a.urgencySignal).toBe(99)
    expect(a.message).toContain('55 minutes to lock')
    expect(a.leagueId).toBe('lg-1')
  })

  it('names the platform, because an imported league is not editable in our app', () => {
    const a = detectInjuredStarterAlerts(ctx([OUT_STARTER]))[0]!
    expect(a.message).toContain('Set your lineup in Sleeper.')
  })

  it('includes the replacement and its projection when one exists', () => {
    const a = detectInjuredStarterAlerts(ctx([OUT_STARTER]))[0]!
    expect(a.message).toContain('Bench Guy')
    expect(a.message).toContain('11.4 projected')
  })

  it('still fires without a replacement rather than staying silent', () => {
    const a = detectInjuredStarterAlerts(ctx([{ ...OUT_STARTER, replacement: null }]))[0]!
    expect(a.message).toContain('Out')
    expect(a.message).not.toContain('best bench option')
  })

  it('does NOT fire on Questionable — crying wolf trains people to ignore it', () => {
    expect(detectInjuredStarterAlerts(ctx([{ ...OUT_STARTER, designation: 'Questionable' }]))).toHaveLength(0)
  })

  it('fires on Doubtful and IR', () => {
    expect(detectInjuredStarterAlerts(ctx([{ ...OUT_STARTER, designation: 'Doubtful' }]))).toHaveLength(1)
    expect(detectInjuredStarterAlerts(ctx([{ ...OUT_STARTER, designation: 'IR' }]))).toHaveLength(1)
  })

  it('goes quiet after lock — nothing can be done, so saying it is noise', () => {
    const past = detectInjuredStarterAlerts(ctx([OUT_STARTER], '2026-09-13T15:00:00Z'))
    expect(past).toHaveLength(0)
  })

  it('scales urgency with time to lock rather than being constant', () => {
    const soon = detectInjuredStarterAlerts(ctx([OUT_STARTER], '2026-09-13T16:30:00Z'))[0]!
    const later = detectInjuredStarterAlerts(ctx([OUT_STARTER], '2026-09-15T16:00:00Z'))[0]!
    expect(soon.urgencySignal).toBeGreaterThan(later.urgencySignal)
  })

  it('caveats a stale designation instead of stating it plainly', () => {
    const a = detectInjuredStarterAlerts(ctx([{ ...OUT_STARTER, stale: true }]))[0]!
    expect(a.message).toContain('has not updated recently')
    // And trusts it less.
    expect(a.confidenceScore).toBeLessThan(94)
  })

  it('emits nothing when the signal was gathered and found no injured starters', () => {
    expect(detectInjuredStarterAlerts(ctx([]))).toHaveLength(0)
  })

  it('repeats more often inside the lock window than outside it', () => {
    const soon = detectInjuredStarterAlerts(ctx([OUT_STARTER]))[0]!
    const later = detectInjuredStarterAlerts(ctx([OUT_STARTER], '2026-09-15T16:00:00Z'))[0]!
    expect(soon.repeatCooldownMinutes).toBeLessThan(later.repeatCooldownMinutes)
  })
})

describe('per-player lock times', () => {
  it("uses the player's OWN kickoff, not a league-wide lock", () => {
    // League lock says 4 hours out; this player's game starts in 30 minutes.
    const alerts = detectInjuredStarterAlerts(
      ctx([{ ...OUT_STARTER, lockAt: '2026-09-13T16:35:00Z' }], '2026-09-13T20:00:00Z'),
    )
    expect(alerts).toHaveLength(1)
    // 30 minutes out => top urgency, which a league-wide 4-hour lock would have missed.
    expect(alerts[0]!.urgencySignal).toBe(99)
    expect(alerts[0]!.message).toContain('30 minutes to lock')
    expect(alerts[0]!.urgencyDeadlineAt).toBe('2026-09-13T16:35:00Z')
  })

  it('falls back to the league lock when the player has no scheduled game', () => {
    const a = detectInjuredStarterAlerts(ctx([{ ...OUT_STARTER, lockAt: null }]))[0]!
    expect(a.message).toContain('55 minutes to lock')
  })

  it('goes quiet once the players OWN game has started, even if others have not', () => {
    const alerts = detectInjuredStarterAlerts(
      // His game kicked off an hour ago; the league-wide lock is still ahead.
      ctx([{ ...OUT_STARTER, lockAt: '2026-09-13T15:00:00Z' }], '2026-09-13T20:00:00Z'),
    )
    expect(alerts).toHaveLength(0)
  })

  it('evaluates each player against his own kickoff independently', () => {
    const thursday = { ...OUT_STARTER, playerName: 'Thursday Guy', lockAt: '2026-09-10T00:15:00Z' }
    const sunday = { ...OUT_STARTER, playerName: 'Sunday Guy', lockAt: '2026-09-13T16:30:00Z' }
    const alerts = detectInjuredStarterAlerts(ctx([thursday, sunday], null))
    // Thursday already kicked off and is dropped; Sunday is still actionable.
    expect(alerts.map((a) => a.title)).toEqual([
      'Sunday Guy is Out and still starting',
    ])
  })
})
