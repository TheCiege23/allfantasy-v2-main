import { describe, expect, it } from 'vitest'
import { evaluateSurvivorDraftCast } from '@/lib/survivor/survivorDraftStartReadiness'

const rosters = Array.from({ length: 16 }, (_, index) => ({
  id: `roster-${index}`, platformUserId: `user-${index}`,
}))
const base = {
  teamCount: 16,
  slotOrder: rosters.map((roster, index) => ({ slot: index + 1, rosterId: roster.id })),
  rosters,
  existingUserIds: rosters.map((roster) => roster.platformUserId),
  commissionerUserId: 'user-0',
  commissionerPlays: true,
}

describe('Survivor draft start cast gate', () => {
  it('allows a complete claimed cast with a participating commissioner', () => {
    expect(evaluateSurvivorDraftCast(base)).toEqual({ ready: true })
  })
  it('stops an open seat before picks are made', () => {
    expect(evaluateSurvivorDraftCast({ ...base, rosters: rosters.map((roster, i) =>
      i === 4 ? { ...roster, platformUserId: 'open-slot-league-5' } : roster),
    })).toMatchObject({ ready: false, error: expect.stringContaining('1 open Survivor cast seat') })
  })
  it('stops duplicate owners, missing real users, and a host-only commissioner in a cast seat', () => {
    expect(evaluateSurvivorDraftCast({ ...base, rosters: rosters.map((roster, i) =>
      i === 4 ? { ...roster, platformUserId: 'user-0' } : roster),
    })).toMatchObject({ ready: false, error: expect.stringContaining('different manager') })
    expect(evaluateSurvivorDraftCast({ ...base, existingUserIds: base.existingUserIds.slice(1) }))
      .toMatchObject({ ready: false })
    expect(evaluateSurvivorDraftCast({ ...base, commissionerPlays: false }))
      .toMatchObject({ ready: false, error: expect.stringContaining('host only') })
  })
  it('stops incomplete or repeated draft slots', () => {
    expect(evaluateSurvivorDraftCast({ ...base, slotOrder: base.slotOrder.slice(1) }))
      .toMatchObject({ ready: false })
    expect(evaluateSurvivorDraftCast({ ...base, slotOrder: base.slotOrder.map(() => base.slotOrder[0]) }))
      .toMatchObject({ ready: false })
  })
  it('lets a host who owns no cast seat start once all managers have claimed seats', () => {
    expect(evaluateSurvivorDraftCast({ ...base, commissionerUserId: 'host', commissionerPlays: false }))
      .toEqual({ ready: true })
  })
})
