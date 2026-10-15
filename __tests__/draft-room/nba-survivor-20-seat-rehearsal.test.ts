import { describe, expect, it } from 'vitest'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { isDraftBoardFull } from '@/lib/live-draft-engine/draftPickEmpty'

describe('20-manager NBA Survivor snake draft rehearsal', () => {
  it('fills 12 roster spots for every manager and closes only after pick 240', () => {
    const teamCount = 20
    const rounds = 12
    const totalPicks = teamCount * rounds
    const slotOrder = Array.from({ length: teamCount }, (_, index) => ({
      slot: index + 1,
      rosterId: `roster-${index + 1}`,
      displayName: `Manager ${index + 1}`,
    }))
    const picks: Array<{ overall: number; playerName: string; position: string }> = []
    const rosterPickCounts = new Map(slotOrder.map((slot) => [slot.rosterId, 0]))

    for (let overall = 1; overall <= totalPicks; overall++) {
      const onClock = resolveCurrentOnTheClock({
        totalPicks, picks, teamCount, draftType: 'snake', thirdRoundReversal: false, slotOrder,
      })
      expect(onClock?.overall).toBe(overall)
      const owner = resolvePickOwner(onClock!.round, onClock!.slot, slotOrder)
      expect(owner?.rosterId).toBe(onClock?.rosterId)
      rosterPickCounts.set(owner!.rosterId, (rosterPickCounts.get(owner!.rosterId) ?? 0) + 1)
      picks.push({ overall, playerName: `Player ${overall}`, position: 'PG' })
      expect(isDraftBoardFull(picks, totalPicks)).toBe(overall === totalPicks)
    }

    expect(rosterPickCounts.size).toBe(teamCount)
    expect([...rosterPickCounts.values()]).toEqual(Array(teamCount).fill(rounds))
    expect(resolveCurrentOnTheClock({
      totalPicks, picks, teamCount, draftType: 'snake', thirdRoundReversal: false, slotOrder,
    })).toBeNull()
  })
})
