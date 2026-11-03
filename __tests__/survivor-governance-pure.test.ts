import { describe, expect, it } from 'vitest'
import { isBeforeCutoff, weekOneCutoffDay, weekOneExcludedPoints } from '@/lib/survivor/survivorWeekOneWindow'
import { experienceSplitOrder, resolveCastawayExperience } from '@/lib/survivor/survivorExperience'
import { computeTribeAssignment } from '@/lib/survivor/survivorTribeAssignmentEngine'
import { castawayNameWithTribeEmoji, decorateNamesWithTribeEmoji, tribeEmojiFor } from '@/lib/survivor/survivorTribeEmoji'
import { deriveSurvivorAttentionSignals } from '@/lib/decision-os/survivorSignals'
import { survivorGovernanceGroundingLine } from '@/lib/survivor/survivorGovernanceSummary'
import { SURVIVOR_GOVERNANCE_DEFAULTS } from '@/lib/survivor/survivorGovernanceSettings'

describe('week-1 partial scoring window', () => {
  // NFL 2026 week 1: Thursday 2026-09-10 20:20 ET kickoff (00:20Z on the 11th).
  const thursday = new Date('2026-09-11T00:20:00Z')
  const friday = new Date('2026-09-12T00:15:00Z')
  const sunday = new Date('2026-09-13T17:00:00Z')

  it('the cutoff is the first chosen weekday on or after the week’s first kickoff (Eastern dates)', () => {
    expect(weekOneCutoffDay(thursday, 'Saturday')).toBe('2026-09-12')
    expect(weekOneCutoffDay(thursday, 'Thursday')).toBe('2026-09-10')
    expect(weekOneCutoffDay(null, 'Saturday')).toBeNull()
  })

  it('Thursday and Friday players do not count; Sunday players do; unknown kickoffs keep their points', () => {
    const cutoff = weekOneCutoffDay(thursday, 'Saturday')
    expect(isBeforeCutoff(thursday, cutoff)).toBe(true)
    expect(isBeforeCutoff(friday, cutoff)).toBe(true)
    expect(isBeforeCutoff(sunday, cutoff)).toBe(false)
    const points = [
      { playerId: 'qb', points: 22.4, isStarter: true },
      { playerId: 'wr', points: 10, isStarter: true },
      { playerId: 'rb', points: 15, isStarter: true },
      { playerId: 'bench', points: 30, isStarter: false },
      { playerId: 'te', points: 7, isStarter: true },
    ]
    const kickoffs = new Map<string, Date | null>([['qb', thursday], ['wr', friday], ['rb', sunday], ['bench', thursday], ['te', null]])
    expect(weekOneExcludedPoints(points, kickoffs, cutoff)).toBe(32.4)
    expect(weekOneExcludedPoints(points, kickoffs, null)).toBe(0)
  })
})

describe('Rooks vs Vets', () => {
  it('manual flag, then this league’s history, then rookie', () => {
    const resolved = resolveCastawayExperience(['u1', 'u2', 'u3'], { u3: 'rookie' }, new Set(['u2', 'u3']))
    expect(resolved).toEqual({
      u1: { experience: 'rookie', source: 'default' },
      u2: { experience: 'veteran', source: 'history' },
      u3: { experience: 'rookie', source: 'manual' },
    })
    expect(experienceSplitOrder(['v1', 'r1', 'v2', 'r2'], { v1: 'veteran', v2: 'veteran' })).toEqual(['r1', 'r2', 'v1', 'v2'])
  })

  it('a random draw with the split puts 10 rookies against 10 veterans', () => {
    const participants = Array.from({ length: 20 }, (_, i) => ({ userId: `u${i}`, rosterId: `r${i}`, displayName: `M${i}` }))
    const experience = Object.fromEntries(participants.map((p, i) => [p.userId, i % 2 === 0 ? 'veteran' as const : 'rookie' as const]))
    const result = computeTribeAssignment({ participants, tribeCount: 2, mode: 'random', seed: 7, experience })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const kinds = result.tribes.map((t) => new Set(t.memberUserIds.map((id) => experience[id])))
    expect(kinds.map((k) => [...k])).toEqual([['rookie'], ['veteran']])
    // Without the split the same seed mixes them.
    const mixed = computeTribeAssignment({ participants, tribeCount: 2, mode: 'random', seed: 7 })
    expect(mixed.ok && mixed.tribes.some((t) => new Set(t.memberUserIds.map((id) => experience[id])).size === 2)).toBe(true)
  })

  it('uneven groups share the boundary tribe and sizes stay balanced', () => {
    const participants = Array.from({ length: 12 }, (_, i) => ({ userId: `u${i}`, rosterId: `r${i}`, displayName: `M${i}` }))
    const experience = Object.fromEntries(participants.map((p, i) => [p.userId, i < 4 ? 'veteran' as const : 'rookie' as const]))
    const result = computeTribeAssignment({ participants, tribeCount: 3, mode: 'random', seed: 1, experience })
    expect(result.ok && result.tribes.map((t) => t.memberUserIds.length)).toEqual([4, 4, 4])
    expect(result.ok && result.tribes[2]!.memberUserIds.every((id) => experience[id] === 'veteran')).toBe(true)
  })
})

describe('tribe emoji in names (display only)', () => {
  it('uses the tribe name’s leading icon, else the catalogue mascot', () => {
    expect(tribeEmojiFor({ name: '🦂 Scorps', catalogId: 'crab' })).toBe('🦂')
    expect(tribeEmojiFor({ name: 'Kaniva', catalogId: 'crab' })).toBe('🦀')
    expect(tribeEmojiFor({ name: 'Custom', catalogId: null })).toBeNull()
  })
  it('decorates only when on, never twice', () => {
    expect(castawayNameWithTribeEmoji('Jordan', '🦂', false)).toBe('Jordan')
    expect(castawayNameWithTribeEmoji('Jordan 🦂', '🦂', true)).toBe('Jordan 🦂')
    const tribes = new Map([['r1', { name: '🦂 Scorps', catalogId: null }], ['r2', null]])
    expect(decorateNamesWithTribeEmoji({ r1: 'Ana', r2: 'Ben' }, tribes, true)).toEqual({ r1: 'Ana 🦂', r2: 'Ben' })
    expect(decorateNamesWithTribeEmoji({ r1: 'Ana' }, tribes, false)).toEqual({ r1: 'Ana' })
  })
})

describe('Decision OS Survivor signals', () => {
  const now = new Date('2026-11-05T15:00:00Z')
  const base = { leagueId: 'L1', now, activeCastaway: true, preMerge: true, myStrikeCount: 0, strikeLimit: 2, swap: null, tradeWindow: null }

  it('cross-tribe trade window closes tonight', () => {
    const signals = deriveSurvivorAttentionSignals({ ...base, tradeWindow: { crossTribeClosesAt: new Date('2026-11-06T00:00:00Z'), frozen: false, freezeStartsAt: null } })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ type: 'survivor_trade_window', severity: 'medium', title: 'Cross-tribe trade window closes tonight', source: 'survivor', leagueId: 'L1' })
    // More than 12h away: nothing yet.
    expect(deriveSurvivorAttentionSignals({ ...base, tradeWindow: { crossTribeClosesAt: new Date('2026-11-07T00:00:00Z'), frozen: false, freezeStartsAt: null } })).toEqual([])
  })

  it('you have 1 strike — high when one more reaches the limit', () => {
    const [signal] = deriveSurvivorAttentionSignals({ ...base, myStrikeCount: 1 })
    expect(signal).toMatchObject({ type: 'survivor_conduct_strike', title: 'You have 1 conduct strike', severity: 'high' })
    const [es] = deriveSurvivorAttentionSignals({ ...base, myStrikeCount: 1, strikeLimit: 3, language: 'es' })
    expect(es).toMatchObject({ title: 'Tienes 1 falta de conducta', severity: 'medium' })
  })

  it('swap this week, without revealing the draw; only for castaways still in the game', () => {
    const [signal] = deriveSurvivorAttentionSignals({ ...base, swap: { week: 6, revealAt: new Date('2026-11-06T00:15:00Z') } })
    expect(signal).toMatchObject({ type: 'survivor_tribe_swap', title: 'Tribe swap this week', id: 'survivor_tribe_swap:L1:week:6' })
    expect(deriveSurvivorAttentionSignals({ ...base, activeCastaway: false, swap: { week: 6, revealAt: null } })).toEqual([])
  })
})

describe('Chimmy grounding line', () => {
  it('names the rules and only the user’s own counts', () => {
    const line = survivorGovernanceGroundingLine({
      settings: { ...SURVIVOR_GOVERNANCE_DEFAULTS, tradeRulesEnabled: true, alliancesEnabled: true, swapSchedule: [{ week: 6, mode: 'resize', tribeCount: 3 }] },
      tradeWindow: null, currentWeek: 4, myStrikeCount: 1, myAllianceCount: 2, merged: false,
    })
    expect(line).toContain('cross-tribe only until Thursday 19:00 ET')
    expect(line).toContain('user has 1')
    expect(line).toContain('user is in 2')
    expect(line).toContain('Chimmy never joins one')
    expect(line).toContain('week 6 (resize)')
  })
})
