import { describe, expect, it } from 'vitest'
import { buildCommissionerSetupChecklist as build } from '@/lib/league/commissioner-setup-checklist'

const full = {
  teamCount: 2,
  teams: [{ claimedByUserId: 'a' }, { claimedByUserId: 'b' }],
  rosterConfigured: true, scoringConfigured: true,
  rosterIds: ['r1', 'r2'],
  draft: { draftType: 'snake', rounds: 15, slotOrder: [
    { slot: 1, rosterId: 'r1' }, { slot: 2, rosterId: 'r2' },
  ] },
  draftDate: null,
}
describe('commissioner setup checklist', () => {
  it('does not require a schedule when all required setup is saved', () => {
    const result = build(full)
    expect(result).toMatchObject({ ready: true, completed: 6, total: 6 })
    expect(result.steps.find(s => s.id === 'date')).toMatchObject({ done: false, optional: true })
  })
  it('identifies missing managers despite allocated open slots', () => {
    const result = build({ ...full, teams: [{ claimedByUserId: 'a' }, { platformUserId: 'open-slot-2', isOrphan: true }] })
    expect(result.ready).toBe(false)
    expect(result.steps.find(s => s.id === 'managers')).toMatchObject({ done: false, detail: '1/2 managers assigned · 1 open slot', panel: 'invite' })
  })
  it.each([
    [], [{ slot: 1, rosterId: 'r1' }],
    [{ slot: 1, rosterId: 'r1' }, { slot: 1, rosterId: 'r2' }],
    [{ slot: 1, rosterId: 'r1' }, { slot: 2, rosterId: 'r1' }],
    [{ slot: 0, rosterId: 'r1' }, { slot: 2, rosterId: 'r2' }],
    [null, { slot: 2, rosterId: 'r2' }],
    [{ slot: 1, rosterId: 'r1' }, { slot: 2, rosterId: 'another-league-roster' }],
    [{ slot: 1, rosterId: 'r1' }, { slot: 2, rosterId: 'r2' }, null],
  ].map(order => [order]))('rejects incomplete or invalid saved order %j', (order) => {
    const result = build({ ...full, draft: { ...full.draft, slotOrder: order } })
    expect(result.steps.find(s => s.id === 'order')?.done).toBe(false)
  })
  it('keeps unavailable roster/scoring/room configuration incomplete', () => {
    const result = build({ ...full, draft: null, rosterConfigured: false, scoringConfigured: false })
    expect(result.ready).toBe(false)
    expect(result.steps.filter(s => ['rules', 'scoring', 'format', 'order', 'room'].includes(s.id)).every(s => !s.done)).toBe(true)
  })
  it('requires real saved date values', () => {
    expect(build({ ...full, draftDate: 'invalid' }).steps.find(s => s.id === 'date')?.done).toBe(false)
    expect(build({ ...full, draftDate: '2026-11-01T18:00:00Z' }).steps.find(s => s.id === 'date')?.done).toBe(true)
  })
})
