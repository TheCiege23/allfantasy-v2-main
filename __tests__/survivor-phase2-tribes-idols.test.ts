/**
 * Survivor Phase 2 — tribe assignment, idol seeding, and intro template (pure engines).
 *
 * These cover the real logic that gates Phase 2: balanced/deterministic tribe assignment,
 * manual + draft-pattern validation, idol count rule (rosterSpots + tribeCount) with multiples
 * allowed, and the host intro template never leaking hidden idol ownership. No DB / no AI.
 */

import { describe, it, expect } from 'vitest'
import {
  computeTribeAssignment,
  defaultTribeName,
  type AssignmentParticipant,
} from '../lib/survivor/survivorTribeAssignmentEngine'
import { computeIdolSeedPlan, computePlayerBoundIdolSeedPlan, SURVIVOR_IDOL_CATALOG } from '../lib/survivor/survivorIdolSeedingEngine'
import { buildSurvivorIntroAnnouncement, buildSurvivorIntroSummary } from '../lib/survivor/survivorPromptTemplates'

function makeParticipants(n: number): AssignmentParticipant[] {
  return Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, rosterId: `r${i}`, displayName: `Player ${i}` }))
}

describe('computeTribeAssignment — random', () => {
  it('balances tribes so sizes differ by at most one', () => {
    const result = computeTribeAssignment({ participants: makeParticipants(18), tribeCount: 4, mode: 'random', seed: 42 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const sizes = result.tribes.map((t) => t.memberUserIds.length)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    // every participant placed exactly once
    const all = result.tribes.flatMap((t) => t.memberUserIds)
    expect(all.length).toBe(18)
    expect(new Set(all).size).toBe(18)
  })

  it('is deterministic for the same seed and differs across seeds', () => {
    const a = computeTribeAssignment({ participants: makeParticipants(16), tribeCount: 4, mode: 'random', seed: 7 })
    const b = computeTribeAssignment({ participants: makeParticipants(16), tribeCount: 4, mode: 'random', seed: 7 })
    const c = computeTribeAssignment({ participants: makeParticipants(16), tribeCount: 4, mode: 'random', seed: 99 })
    expect(a.ok && b.ok && c.ok).toBe(true)
    if (!a.ok || !b.ok || !c.ok) return
    expect(a.tribes).toEqual(b.tribes)
    expect(a.tribes).not.toEqual(c.tribes)
    expect(a.seed).toBe(7)
  })

  it('rejects too-few participants and invalid tribe counts', () => {
    expect(computeTribeAssignment({ participants: [], tribeCount: 4, mode: 'random', seed: 1 })).toMatchObject({ ok: false, code: 'no_participants' })
    expect(computeTribeAssignment({ participants: makeParticipants(3), tribeCount: 4, mode: 'random', seed: 1 })).toMatchObject({ ok: false, code: 'invalid_tribe_count' })
    expect(computeTribeAssignment({ participants: makeParticipants(8), tribeCount: 1, mode: 'random', seed: 1 })).toMatchObject({ ok: false, code: 'invalid_tribe_count' })
  })
})

describe('computeTribeAssignment — manual', () => {
  it('accepts a complete, balanced mapping', () => {
    const participants = makeParticipants(8)
    const mapping: Record<string, number> = {}
    participants.forEach((p, i) => (mapping[p.userId] = i % 4))
    const result = computeTribeAssignment({ participants, tribeCount: 4, mode: 'commissioner_manual', manualMapping: mapping })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tribes.every((t) => t.memberUserIds.length === 2)).toBe(true)
  })

  it('rejects an incomplete mapping (unassigned participants)', () => {
    const participants = makeParticipants(8)
    const mapping: Record<string, number> = { u0: 0, u1: 1 }
    const result = computeTribeAssignment({ participants, tribeCount: 4, mode: 'commissioner_manual', manualMapping: mapping })
    expect(result).toMatchObject({ ok: false, code: 'manual_invalid' })
  })

  it('rejects an unbalanced mapping', () => {
    const participants = makeParticipants(8)
    const mapping: Record<string, number> = {}
    participants.forEach((p) => (mapping[p.userId] = 0)) // everyone in tribe 0
    const result = computeTribeAssignment({ participants, tribeCount: 4, mode: 'commissioner_manual', manualMapping: mapping })
    expect(result).toMatchObject({ ok: false, code: 'manual_invalid' })
  })
})

describe('computeTribeAssignment — draft_pattern', () => {
  it('returns limited_data when draft order is missing/incomplete (no fabrication)', () => {
    const participants = makeParticipants(8)
    expect(computeTribeAssignment({ participants, tribeCount: 4, mode: 'draft_pattern', draftOrder: null })).toMatchObject({ ok: false, code: 'limited_data' })
    expect(computeTribeAssignment({ participants, tribeCount: 4, mode: 'draft_pattern', draftOrder: ['u0', 'u1'] })).toMatchObject({ ok: false, code: 'limited_data' })
  })

  it('distributes by draft order when complete', () => {
    const participants = makeParticipants(8)
    const order = participants.map((p) => p.userId)
    const result = computeTribeAssignment({ participants, tribeCount: 4, mode: 'draft_pattern', draftOrder: order })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // snake/round-robin: u0,u4 in slot0; u1,u5 in slot1 ...
    expect(result.tribes[0].memberUserIds).toEqual(['u0', 'u4'])
  })
})

describe('defaultTribeName', () => {
  it('produces unique names across the default tribe slots', () => {
    const names = [0, 1, 2, 3, 4, 5].map(defaultTribeName)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('computeIdolSeedPlan', () => {
  it('seeds exactly rosterSpots + tribeCount Vote Shield idols (15 + 4 = 19)', () => {
    const plan = computeIdolSeedPlan({ participants: makeParticipants(16), rosterSpots: 15, tribeCount: 4, seed: 5 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.voteShieldCount).toBe(19)
    expect(plan.assignments.length).toBe(19)
    expect(plan.assignments.every((a) => a.powerType === 'vote_shield')).toBe(true)
  })

  it('allows multiple idols per user (19 idols across 16 users)', () => {
    const plan = computeIdolSeedPlan({ participants: makeParticipants(16), rosterSpots: 15, tribeCount: 4, seed: 5 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const counts = new Map<string, number>()
    for (const a of plan.assignments) counts.set(a.ownerUserId, (counts.get(a.ownerUserId) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(2)
    // balanced: nobody hoards — per-user counts differ by at most one
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1)
  })

  it('is deterministic for the same seed', () => {
    const a = computeIdolSeedPlan({ participants: makeParticipants(16), rosterSpots: 15, tribeCount: 4, seed: 11 })
    const b = computeIdolSeedPlan({ participants: makeParticipants(16), rosterSpots: 15, tribeCount: 4, seed: 11 })
    expect(a).toEqual(b)
  })

  it('expires Vote Shield idols when 5 players remain', () => {
    const plan = computeIdolSeedPlan({ participants: makeParticipants(16), rosterSpots: 15, tribeCount: 4, seed: 1 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.assignments[0].expiresAtRemainingPlayers).toBe(5)
    expect(SURVIVOR_IDOL_CATALOG.vote_shield.expiresAtRemainingPlayers).toBe(5)
  })

  it('rejects when there are no participants', () => {
    expect(computeIdolSeedPlan({ participants: [], rosterSpots: 15, tribeCount: 4, seed: 1 })).toMatchObject({ ok: false, code: 'no_participants' })
  })
})

describe('player-bound NBA idol plan', () => {
  const candidates = Array.from({ length: 18 }, (_, owner) =>
    Array.from({ length: 3 }, (_, player) => ({ ownerUserId: `owner-${owner}`, rosterId: `roster-${owner}`, playerId: `nba-${owner}-${player}` })),
  ).flat()

  it('gives six distinct managers a player-bound idol by default', () => {
    const plan = computePlayerBoundIdolSeedPlan({ candidates, idolCount: 6, seed: 9 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.assignments).toHaveLength(6)
    expect(new Set(plan.assignments.map(assignment => assignment.ownerUserId)).size).toBe(6)
    expect(new Set(plan.assignments.map(assignment => assignment.playerId)).size).toBe(6)
    expect(plan.assignments.every(assignment => candidates.some(candidate => candidate.playerId === assignment.playerId && candidate.rosterId === assignment.rosterId))).toBe(true)
  })

  it('allows extra idols to land on the same manager without duplicating a player', () => {
    const plan = computePlayerBoundIdolSeedPlan({ candidates, idolCount: 21, seed: 9 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(new Set(plan.assignments.map(assignment => assignment.playerId)).size).toBe(21)
    expect(new Set(plan.assignments.map(assignment => assignment.ownerUserId)).size).toBeLessThan(21)
    expect(computePlayerBoundIdolSeedPlan({ candidates, idolCount: 21, seed: 9 })).toEqual(plan)
  })

  it('refuses unavailable powers and missing stable player identities', () => {
    expect(computePlayerBoundIdolSeedPlan({ candidates, idolCount: 1, powerPool: ['triple_steal'], seed: 1 })).toMatchObject({ ok: false, code: 'unavailable_power' })
    expect(computePlayerBoundIdolSeedPlan({ candidates: [...candidates, candidates[0]], idolCount: 6, seed: 1 })).toMatchObject({ ok: false, code: 'invalid_draft_players' })
  })
})

describe('survivor intro template', () => {
  const ctx = {
    leagueName: 'Island League',
    sport: 'NFL',
    castSize: 16,
    tribeCount: 4,
    mergeAtActivePlayers: 10,
    privateVotesOnly: true,
    coManagerDisallowed: true,
    screenshotsAllowedExceptHostDm: true,
  }

  it('includes cast size, tribe count, and merge threshold', () => {
    const text = buildSurvivorIntroAnnouncement(ctx)
    expect(text).toContain('Island League')
    expect(text).toContain('4 tribes')
    expect(text).toContain('merges at 10')
  })

  it('mentions idols only as a possibility, never an owner', () => {
    const text = buildSurvivorIntroAnnouncement(ctx).toLowerCase()
    expect(text).toContain('idol')
    expect(text).toContain('may')
    // must not leak any specific holder
    expect(text).not.toMatch(/u\d+|r\d+|holds the idol|owner/)
  })

  it('summary is a single line with the key facts', () => {
    const summary = buildSurvivorIntroSummary(ctx)
    expect(summary).not.toContain('\n')
    expect(summary).toContain('16 managers')
    expect(summary).toContain('4 tribes')
  })
})
