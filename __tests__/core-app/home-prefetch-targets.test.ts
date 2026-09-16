import { describe, expect, it } from 'vitest'
import { HOME_PREFETCH_LIMIT, homePrefetchTargets } from '@/lib/core-app/homePrefetchTargets'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

function decision(id: string, leagueId: string | null, action: CoreIssue['action']): CoreIssue {
  return {
    id,
    severity: 'bad',
    glyph: '•',
    title: id,
    meta: '',
    leagueId,
    leagueName: null,
    platform: null,
    deadline: null,
    action,
  }
}

const quiet = { unreadNotifications: 0, gameDayActive: false, hasRecentTrades: false }

describe('homePrefetchTargets', () => {
  it('warms nothing on a quiet home — every target is conditional', () => {
    expect(homePrefetchTargets({ decisions: [], ...quiet })).toEqual([])
  })

  it('warms the top decision’s screen, then its league, and stays within the cap', () => {
    const decisions = [decision('slot', 'L 1', { label: 'Fill', href: '/core/my-team?league=L%201', external: false })]
    const targets = homePrefetchTargets({
      decisions,
      unreadNotifications: 2,
      gameDayActive: true,
      hasRecentTrades: true,
    })
    expect(targets).toEqual(['/core/my-team?league=L%201', '/core?league=L%201', '/core/notifications'])
    expect(targets).toHaveLength(HOME_PREFETCH_LIMIT)
  })

  it('never warms a provider link or anything off /core, and never twice', () => {
    const decisions = [
      decision('stale', 'A', { label: 'Open Sleeper', href: 'https://sleeper.com/leagues/1', external: true }),
      decision('weird', 'A', { label: 'x', href: '//evil.example/core', external: false }),
    ]
    expect(homePrefetchTargets({ decisions, ...quiet, limit: 10 })).toEqual(['/core?league=A'])
  })

  it('adds live-slate and trade destinations only when they have something to show', () => {
    expect(homePrefetchTargets({ decisions: [], ...quiet, gameDayActive: true, hasRecentTrades: true })).toEqual([
      '/core/week',
      '/core/trades',
    ])
  })
})
