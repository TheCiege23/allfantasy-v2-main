/**
 * Chimmy's manager profile (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 2): the personality a
 * team keeps for the season, reduced to the traits the season code reads.
 */
import { describe, expect, it } from 'vitest'
import { NPC_DRAFT_PERSONALITIES } from '@/lib/live-draft-engine/npcDraftPersonalityTypes'
import { AUTOPILOT_STYLES, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import {
  MANAGER_ACTIVITY,
  STYLE_HORIZON,
  WEEKLY_OFFER_LIMIT,
  assignedPersonalityFor,
  positionBiasFor,
  resolveManagerProfile,
} from '@/lib/inactive-manager/managerProfile'

describe('resolveManagerProfile', () => {
  it('every personality resolves to traits inside their ranges, with words for the screen', () => {
    for (const personality of NPC_DRAFT_PERSONALITIES) {
      const p = resolveManagerProfile({ rosterId: 'r1', savedPersonality: personality })
      expect(p.personality).toBe(personality)
      expect(p.risk).toBeGreaterThanOrEqual(-1)
      expect(p.risk).toBeLessThanOrEqual(1)
      expect(p.fairness).toBeGreaterThan(0)
      expect(p.fairness).toBeLessThan(0.5)
      expect(MANAGER_ACTIVITY).toContain(p.activity)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.summary.length).toBeGreaterThan(0)
      // Owner rule: the product never says "AI" to a user.
      expect(`${p.label} ${p.summary}`).not.toMatch(/\bAI\b/)
    }
  })

  it('the saved personality wins, then the draft one, then the one assigned from the roster id', () => {
    expect(resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'RB_HEAVY', draftPersonality: 'WR_HEAVY' })).toMatchObject({ personality: 'RB_HEAVY', source: 'saved' })
    expect(resolveManagerProfile({ rosterId: 'r1', draftPersonality: 'WR_HEAVY' })).toMatchObject({ personality: 'WR_HEAVY', source: 'draft' })
    expect(resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'NOT_A_PERSONALITY' })).toMatchObject({ personality: assignedPersonalityFor('r1'), source: 'assigned' })
  })

  it('the assigned personality is fixed per team and differs across teams', () => {
    expect(assignedPersonalityFor('roster-a')).toBe(assignedPersonalityFor('roster-a'))
    const seen = new Set(Array.from({ length: 60 }, (_, i) => assignedPersonalityFor(`roster-${i}`)))
    expect(seen.size).toBeGreaterThan(8)
  })

  it("the commissioner's style sets the horizon whatever the personality; the default is dynasty owner", () => {
    for (const style of AUTOPILOT_STYLES) {
      expect(resolveManagerProfile({ rosterId: 'r1', style, savedPersonality: 'WIN_NOW_VETERAN' }).horizon).toBe(STYLE_HORIZON[style])
    }
    expect(STYLE_HORIZON.win_now).toBeLessThan(STYLE_HORIZON.dynasty_owner)
    expect(STYLE_HORIZON.dynasty_owner).toBeLessThan(STYLE_HORIZON.rebuild)
    expect(resolveManagerProfile({ rosterId: 'r1' }).style).toBe('dynasty_owner')
  })

  it('a busier manager may send more offers, and position leanings read by position', () => {
    expect(WEEKLY_OFFER_LIMIT.quiet).toBeLessThan(WEEKLY_OFFER_LIMIT.normal)
    expect(WEEKLY_OFFER_LIMIT.normal).toBeLessThan(WEEKLY_OFFER_LIMIT.busy)
    const zeroRb = resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'ZERO_RB' })
    expect(positionBiasFor(zeroRb, 'wr')).toBeGreaterThan(0)
    expect(positionBiasFor(zeroRb, 'RB')).toBeLessThan(0)
    expect(positionBiasFor(zeroRb, 'K')).toBe(0)
    expect(positionBiasFor(zeroRb, null)).toBe(0)
  })
})

describe('the personality saved on a Chimmy team', () => {
  const settings = (autopilot: Record<string, unknown>) => ({ af_managed_lineups: { r1: { since: 's', byUserId: 'u', autopilot: { style: 'win_now', since: 's', byUserId: 'u', ...autopilot } } } })

  it('is read back when valid, and dropped when it is not a personality', () => {
    expect(readManagedLineups(settings({ personality: 'UPSIDE_SWINGER' })).r1.autopilot).toMatchObject({ style: 'win_now', personality: 'UPSIDE_SWINGER' })
    expect(readManagedLineups(settings({ personality: 'TANK' })).r1.autopilot).not.toHaveProperty('personality')
    expect(readManagedLineups(settings({})).r1.autopilot).not.toHaveProperty('personality')
  })
})
