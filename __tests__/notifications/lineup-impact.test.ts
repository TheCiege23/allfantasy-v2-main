// @vitest-environment node
/**
 * Injury alerts only when they change your lineup (owner, 2026-10-25): the rule and the copy.
 */
import { describe, expect, it } from 'vitest'

import type { LeagueCall } from '@/lib/core-app/leagueCall'
import { hasLineupImpact, lineupImpactCopy, lineupImpactKind, type LeagueLineupImpact } from '@/lib/notifications/lineupImpactCopy'

const call = (kind: LeagueCall['kind'], swap: LeagueCall['swap'] = null): LeagueCall => ({
  leagueId: 'L1', leagueName: 'Dynasty', platform: 'sleeper', kind, tone: 'none', headline: '', why: '', swap,
})
const impact = (over: Partial<LeagueLineupImpact>): LeagueLineupImpact => ({
  leagueId: 'L1', leagueName: 'Dynasty', kind: 'none', startName: null, benchName: null, delta: null, freeAgent: null, fixHref: null, ...over,
})

describe('what counts as a lineup change', () => {
  it('a starter ruled out, questionable or cleared from an injury', () => {
    expect(lineupImpactKind({ bucket: 'out', prior: 'questionable', isStarting: true, call: null })).toBe('starter_out')
    expect(lineupImpactKind({ bucket: 'ir', prior: null, isStarting: true, call: null })).toBe('starter_out')
    expect(lineupImpactKind({ bucket: 'questionable', prior: 'active', isStarting: true, call: null })).toBe('starter_questionable')
    expect(lineupImpactKind({ bucket: 'active', prior: 'questionable', isStarting: true, call: null })).toBe('starter_cleared')
  })
  it('a starter "active" with no injury before it is not news', () => {
    expect(lineupImpactKind({ bucket: 'active', prior: null, isStarting: true, call: null })).toBe('none')
    expect(lineupImpactKind({ bucket: 'active', prior: 'active', isStarting: true, call: null })).toBe('none')
  })
  it('a bench player only when he is healthy AND out-projects a starter', () => {
    const start = call('start', { startId: 'b', startName: 'Bench', benchId: 's', benchName: 'Starter' })
    expect(lineupImpactKind({ bucket: 'active', prior: 'out', isStarting: false, call: start })).toBe('bench_should_start')
    expect(lineupImpactKind({ bucket: 'active', prior: 'out', isStarting: false, call: call('hold') })).toBe('none')
    expect(lineupImpactKind({ bucket: 'active', prior: 'out', isStarting: false, call: null })).toBe('none')
    expect(lineupImpactKind({ bucket: 'out', prior: null, isStarting: false, call: start })).toBe('none')
    expect(lineupImpactKind({ bucket: 'questionable', prior: null, isStarting: false, call: null })).toBe('none')
  })
  it('nothing once his game (or the swap partner\'s) has started', () => {
    expect(lineupImpactKind({ bucket: 'out', prior: null, isStarting: true, call: call('locked') })).toBe('none')
  })
})

describe('what the alert says', () => {
  it('a ruled-out starter: the bench player to start, else the free agent, else check free agents', () => {
    expect(lineupImpactCopy('Gibbs', [impact({ kind: 'starter_out', startName: 'Montgomery' })])).toMatchObject({
      title: '🚨 Gibbs is OUT — your lineup options',
      body: 'Dynasty: start Montgomery in place of Gibbs.',
    })
    expect(lineupImpactCopy('Gibbs', [impact({ kind: 'starter_out', freeAgent: { name: 'Free Guy', projectedPoints: 9.25 } })])!.body).toBe(
      'Dynasty: no bench player can come in — add Free Guy (9.3 projected) from free agents.',
    )
    expect(lineupImpactCopy('Gibbs', [impact({ kind: 'starter_out' })])!.body).toBe('Dynasty: no bench player can come in — check free agents.')
  })
  it('a healthy bench player: who to swap him with, and by how much', () => {
    expect(lineupImpactCopy('Nacua', [impact({ kind: 'bench_should_start', startName: 'Nacua', benchName: 'Kupp', delta: 3.4 })])).toMatchObject({
      title: '💪 Nacua is healthy — start him over Kupp',
      body: 'Dynasty: start Nacua over Kupp (+3.4 projected).',
    })
  })
  it('one alert across leagues, most urgent first; leagues with no change are left out', () => {
    const copy = lineupImpactCopy('Gibbs', [
      impact({ leagueId: 'a', leagueName: 'Redraft', kind: 'starter_questionable', startName: 'Backup' }),
      impact({ leagueId: 'b', leagueName: 'Bench League', kind: 'none' }),
      impact({ leagueId: 'c', leagueName: 'Dynasty', kind: 'starter_out', startName: 'Montgomery', fixHref: '/fix' }),
    ])!
    expect(copy.kind).toBe('starter_out')
    expect(copy.fixHref).toBe('/fix')
    expect(copy.body.split('\n')).toEqual([
      'Dynasty: start Montgomery in place of Gibbs.',
      "Redraft: keep him in for now; if he's ruled out, start Backup.",
    ])
  })
  it('no lineup change, no alert', () => {
    expect(lineupImpactCopy('Gibbs', [impact({ kind: 'none' })])).toBeNull()
    expect(hasLineupImpact([impact({ kind: 'none' })])).toBe(false)
  })
})
