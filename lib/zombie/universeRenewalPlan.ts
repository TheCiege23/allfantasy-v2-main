import { createHash } from 'node:crypto'
import { planUniverseMovement, type MovementLevel, type MovementPolicy, type MovementStanding } from './universeMovementPlan'

export type RenewalManager = MovementStanding & { userId: string; displayName: string; teamName: string; avatarUrl: string | null }
export type RenewalPool = { leagueId: string; levelId: string; name: string; seats: number; orderInLevel: number }

/** One manager per universe; fixed capacities must balance before any next-season league is written. */
export function planUniverseRenewal(managers: RenewalManager[], levels: MovementLevel[], policy: MovementPolicy, pools: RenewalPool[], seed: string) {
  if (!managers.length || new Set(managers.map(m => m.userId)).size !== managers.length) throw new Error('RENEWAL_MEMBERSHIP_AMBIGUOUS')
  if (new Set(pools.map(p => p.leagueId)).size !== pools.length ||
      pools.some(p => !levels.some(l => l.id === p.levelId) || !Number.isInteger(p.seats) || p.seats < 2)) throw new Error('RENEWAL_CAPACITY_INVALID')
  const byRoster = new Map(managers.map(m => [m.rosterId, m]))
  const movement = planUniverseMovement(managers, levels, policy)
  const assignments: Array<RenewalManager & { destinationLeagueId: string; destinationLevelId: string; slot: number; movement: string }> = []
  for (const level of levels) {
    const targetPools = pools.filter(p => p.levelId === level.id).sort((a,b) => a.orderInLevel-b.orderInLevel || a.leagueId.localeCompare(b.leagueId))
    const incoming = movement.filter(m => m.projectedLevelId === level.id)
    if (targetPools.reduce((n,p) => n+p.seats,0) !== incoming.length) throw new Error('RENEWAL_CAPACITY_UNBALANCED')
    // A reproducible draw spreads managers across same-level leagues and determines fresh draft slots.
    const key = (id: string) => createHash('sha256').update(JSON.stringify([seed, level.id, id])).digest('hex')
    incoming.sort((a,b) => key(a.rosterId).localeCompare(key(b.rosterId)))
    let cursor = 0
    for (let slot=1; cursor<incoming.length; slot++) for (const pool of targetPools) {
      if (slot > pool.seats) continue
      const row = incoming[cursor++]
      assignments.push({ ...byRoster.get(row.rosterId)!, destinationLeagueId: pool.leagueId, destinationLevelId: level.id, slot, movement: row.reason })
    }
  }
  if (assignments.length !== managers.length) throw new Error('RENEWAL_MEMBERSHIP_AMBIGUOUS')
  return { pools, assignments, movement }
}

/** Stable content token: no process-local IDs or wall clock in the reviewed plan. */
export function renewalFingerprint(value: unknown): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) :
    v && typeof v === 'object' && !(v instanceof Date)
      ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,x]) => [k,stable(x)])) : v
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}
