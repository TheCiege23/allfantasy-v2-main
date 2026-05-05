/**
 * Core live-draft behavior checks (no Prisma): validation + Sleeper-style finalize lineup rules.
 * Complements integration tests that mock the full submitPick stack.
 */

import { describe, expect, it } from 'vitest'
import {
  DRAFT_PICK_DUPLICATE_PLAYER,
  DRAFT_PICK_NOT_ON_CLOCK,
} from '@/lib/live-draft-engine/pickAuthorityCodes'
import { validatePickSubmission } from '@/lib/live-draft-engine/PickValidation'
import { buildLineupSectionsFromPicks } from '@/lib/post-draft/buildStartersFromPicks'
import type { RosterTemplateDto, RosterTemplateSlotDto } from '@/lib/multi-sport/RosterTemplateService'

function slot(
  slotName: string,
  allowedPositions: string[],
  starterCount: number,
  slotOrder: number,
): RosterTemplateSlotDto {
  return {
    slotName,
    allowedPositions,
    starterCount,
    benchCount: 0,
    reserveCount: 0,
    taxiCount: 0,
    devyCount: 0,
    isFlexibleSlot: false,
    slotOrder,
  }
}

describe('validatePickSubmission', () => {
  it('rejects pick when roster is not on the clock', () => {
    const r = validatePickSubmission({
      playerName: 'Patrick Mahomes',
      position: 'QB',
      rosterId: 'team-a',
      currentOnClockRosterId: 'team-b',
      existingPicks: [],
      sessionStatus: 'in_progress',
    })
    expect(r.valid).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_NOT_ON_CLOCK)
  })

  it('rejects duplicate player already drafted', () => {
    const r = validatePickSubmission({
      playerName: 'JaMarr Chase',
      position: 'WR',
      rosterId: 'team-a',
      currentOnClockRosterId: 'team-a',
      existingPicks: [{ playerName: 'JaMarr Chase', position: 'WR' }],
      sessionStatus: 'in_progress',
    })
    expect(r.valid).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_DUPLICATE_PLAYER)
  })

  it('allows SKIP token without duplicate check collision', () => {
    const r = validatePickSubmission({
      playerName: 'SKIP',
      position: 'SKIP',
      rosterId: 'team-a',
      currentOnClockRosterId: 'team-a',
      existingPicks: [],
      sessionStatus: 'in_progress',
    })
    expect(r.valid).toBe(true)
  })
})

describe('buildLineupSectionsFromPicks (finalize / Sleeper-style)', () => {
  const nflTemplate: RosterTemplateDto = {
    templateId: 'unit-test-nfl',
    sportType: 'NFL',
    name: 'Unit',
    formatType: 'REDRAFT',
    slots: [
      slot('QB', ['QB'], 1, 1),
      slot('RB', ['RB'], 1, 2),
      slot('BN', ['QB', 'RB', 'WR', 'TE'], 0, 3),
    ],
  }

  it('fills an open starter slot for exact position before bench', () => {
    const sections = buildLineupSectionsFromPicks(
      [
        {
          playerId: 'p1',
          playerName: 'Runner',
          position: 'RB',
          team: 'DAL',
        },
        {
          playerId: 'p2',
          playerName: 'Thrower',
          position: 'QB',
          team: 'KC',
        },
      ],
      nflTemplate,
    )
    const starterPositions = sections.starters.map((s) => String(s.position))
    expect(starterPositions).toContain('QB')
    expect(starterPositions).toContain('RB')
    expect(sections.bench.length).toBe(0)
  })

  it('places overflow on bench when starter slots for that position are full', () => {
    const sections = buildLineupSectionsFromPicks(
      [
        {
          playerId: 'qb1',
          playerName: 'QB One',
          position: 'QB',
          team: 'A',
        },
        {
          playerId: 'qb2',
          playerName: 'QB Two',
          position: 'QB',
          team: 'B',
        },
      ],
      nflTemplate,
    )
    expect(sections.starters.length).toBe(1)
    expect(sections.bench.length).toBe(1)
    expect(sections.bench[0]?.position).toBe('QB')
  })

  it('does not populate IR, taxi, or devy during finalize lineup build', () => {
    const sections = buildLineupSectionsFromPicks(
      [
        { playerId: 'a', playerName: 'A', position: 'QB', team: 'X' },
        { playerId: 'b', playerName: 'B', position: 'RB', team: 'Y' },
      ],
      nflTemplate,
    )
    expect(sections.ir).toEqual([])
    expect(sections.taxi).toEqual([])
    expect(sections.devy).toEqual([])
  })
})
