import { expect, it, vi } from 'vitest'
import { assertStealThreeWaiverHoldCleared } from '@/lib/survivor/survivorStealThreeWaivers'
const now = new Date('2026-10-13T12:00:00Z')
it('blocks immediate adds of raid drops until clearing but permits unrelated players and cleared holds', async () => {
  const db = { survivorAuditEntry: { findMany: vi.fn(async () => [{ data: { dropPlayerIds: ['d'], waiversClearAt: '2026-10-14T08:00:00Z' } }]) } } as any
  await expect(assertStealThreeWaiverHoldCleared(db, 'league', 'd', now)).rejects.toThrow('must go through waivers')
  await expect(assertStealThreeWaiverHoldCleared(db, 'league', 'other', now)).resolves.toBeUndefined()
  await expect(assertStealThreeWaiverHoldCleared(db, 'league', 'd', new Date('2026-10-14T08:00:00Z'))).resolves.toBeUndefined()
  expect(db.survivorAuditEntry.findMany.mock.calls[0][0].where).toMatchObject({ leagueId: 'league', action: 'steal_three_played' })
})
