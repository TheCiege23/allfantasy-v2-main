import 'server-only'
import { randomInt, randomUUID } from 'node:crypto'
import type { SGPower, SGPowerKind } from './types'

function choose<T>(values: readonly T[], pick: (upper: number) => number): T {
  if (!values.length) throw new Error('A nonempty reward pool is required.')
  const index = pick(values.length)
  if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new Error('Invalid random selection.')
  return values[index]
}

/** Server-only private records; never include these in a public draft pool response. */
export function seedSGDraftIdols(args: {
  playerIds: string[]; count: number; allowedKinds: SGPowerKind[]; expiresAfterPeriod: number
  /** Injection is for deterministic tests. Production uses cryptographic randomness. */
  pick?: (upper: number) => number
}): SGPower[] {
  const players = [...new Set(args.playerIds)]
  const kinds = [...new Set(args.allowedKinds)]
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > players.length) throw new Error('Draft idol count must fit the distinct player pool.')
  if (!Number.isInteger(args.expiresAfterPeriod) || args.expiresAfterPeriod < 1) throw new Error('An expiry period is required.')
  if (!kinds.includes('personal_immunity')) throw new Error('Personal immunity is required in the draft pool.')
  const others = kinds.filter(kind => kind !== 'personal_immunity')
  if (args.count > 1 && !others.length) throw new Error('Enable another power type or seed only the personal immunity idol.')
  const pick = args.pick ?? randomInt
  const records: SGPower[] = []
  for (let i = 0; i < args.count; i++) {
    const playerId = choose(players, pick)
    players.splice(players.indexOf(playerId), 1)
    records.push({
      id: randomUUID(), kind: i === 0 ? 'personal_immunity' : choose(others, pick),
      binding: 'player', playerId, ownerId: '', expiresAfterPeriod: args.expiresAfterPeriod,
      status: 'held', targetTeamId: null, revealed: false,
    })
  }
  return records
}

/** The scheduler supplies the verified recipient; no public announcement is produced. */
export function createSGWeeklyReward(args: {
  managerId: string; allowedKinds: SGPowerKind[]; expiresAfterPeriod: number
  pick?: (upper: number) => number
}): SGPower {
  if (!args.managerId || !Number.isInteger(args.expiresAfterPeriod) || args.expiresAfterPeriod < 1) throw new Error('A recipient and expiry period are required.')
  return {
    id: randomUUID(), kind: choose(args.allowedKinds, args.pick ?? randomInt),
    binding: 'manager', playerId: null, ownerId: args.managerId,
    expiresAfterPeriod: args.expiresAfterPeriod, status: 'held', targetTeamId: null, revealed: false,
  }
}
