import type { SGPower, SGPowerKind } from './types'

export const SG_POWER_LABELS: Record<SGPowerKind, string> = {
  personal_immunity: 'Personal Immunity', ally_immunity: 'Ally Immunity',
  steal_player: 'Player Steal', tribe_swap: 'Tribe Swap', faab_bonus: 'FAAB Cache',
}

/** Call on the server before serializing. Commissioner status grants no secret access. */
export function powersVisibleTo(powers: SGPower[], viewerId: string): SGPower[] {
  return powers.filter(power => (Boolean(viewerId) && power.ownerId === viewerId) || (power.status === 'used' && power.revealed)).map(power => ({ ...power }))
}

/** Player-bound powers follow roster ownership; manager rewards die with their holder. */
export function reconcileSGPowerOwnership(args: {
  powers: SGPower[]; playerOwnerById: Record<string, string | undefined>
  eliminatedManagerIds: string[]; period: number; mergePeriod: number
}): SGPower[] {
  const eliminated = new Set(args.eliminatedManagerIds)
  return args.powers.flatMap(power => {
    if (power.status === 'used') return [{ ...power }]
    if (power.status === 'expired') return []
    if (args.period >= args.mergePeriod || args.period > power.expiresAfterPeriod) return []
    if (power.binding === 'manager') return eliminated.has(power.ownerId) ? [] : [{ ...power }]
    const ownerId = power.playerId ? args.playerOwnerById[power.playerId] : undefined
    // Unclaimed player-bound idols remain attached in the waiver pool, with no manager access.
    return [{ ...power, ownerId: ownerId && !eliminated.has(ownerId) ? ownerId : '',
      status: ownerId !== power.ownerId ? 'held' as const : power.status,
      targetTeamId: ownerId !== power.ownerId ? null : power.targetTeamId }]
  })
}

export function validateSGPowerPlay(args: {
  power: SGPower; managerId: string; period: number; mergePeriod: number
  now: string; deadline: string; ceremonyStarted: boolean
  rosterPlayerIds: string[]; targetPlayerLocked?: boolean; rosterFull?: boolean; dropPlayerId?: string
}): string | null {
  const { power } = args
  if (power.ownerId !== args.managerId || !args.managerId) return 'You do not own this power.'
  if (power.status !== 'held') return 'This power is already sealed or consumed.'
  if (args.period >= args.mergePeriod || args.period > power.expiresAfterPeriod) return 'This power has expired.'
  const now = Date.parse(args.now), deadline = Date.parse(args.deadline)
  if (!Number.isFinite(now) || !Number.isFinite(deadline) || now >= deadline) return 'The activation deadline has passed or is unavailable.'
  if ((power.kind === 'personal_immunity' || power.kind === 'ally_immunity') && args.ceremonyStarted) return 'The chop ceremony has already begun.'
  if (power.binding === 'player' && (!power.playerId || !args.rosterPlayerIds.includes(power.playerId))) return 'The attached player must be on your roster, including bench or IR.'
  if (power.kind === 'steal_player') {
    if (args.targetPlayerLocked !== false) return 'The target must be confirmed unlocked before their game starts.'
    if (args.rosterFull && (!args.dropPlayerId || !args.rosterPlayerIds.includes(args.dropPlayerId))) return 'Choose a rostered player to drop first.'
  }
  return null
}

/** Exact command parser. Resolving ids, authorization and execution remain server responsibilities. */
export function parseSGPowerCommand(raw: string): { powerId: string; targetId: string | null } | null {
  const match = raw.trim().match(/^@chimmy\s+(?:use|play)\s+(?:idol|token)\s+([a-z0-9_-]+)(?:\s+on\s+([a-z0-9_-]+))?\s*$/i)
  return match ? { powerId: match[1], targetId: match[2] ?? null } : null
}

export function parseSGActionCommand(raw: string): { powerId: string; targetId: string | null; dropPlayerId: string | null } | null {
  const match = raw.trim().match(/^@chimmy\s+(?:use|play)\s+(?:idol|token)\s+([a-z0-9_-]+)(?:\s+on\s+([a-z0-9_-]+))?(?:\s+drop\s+([a-z0-9_-]+))?\s*$/i)
  return match ? { powerId: match[1], targetId: match[2] ?? null, dropPlayerId: match[3] ?? null } : null
}

export function sgPowerRevealMoment(kind: SGPowerKind): 'chop' | 'execution' {
  return kind === 'personal_immunity' || kind === 'ally_immunity' ? 'chop' : 'execution'
}
