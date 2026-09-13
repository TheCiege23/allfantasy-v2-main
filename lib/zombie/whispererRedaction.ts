/**
 * Server-side redaction of the Whisperer's identity, for a viewer who may not know it.
 *
 * WHO may know is decided by `canViewerSeeWhisperer` (./whispererVisibility), resolved per request
 * by `resolveWhispererViewer` (./whispererViewer). This module only removes the identity from what
 * is returned. Nulling one id field is not enough, because the Whisperer is identifiable through
 * every row that describes it:
 *
 * - its team row says `status: 'Whisperer'` and `isWhisperer: true`, and carries ambush counts;
 * - teams it infected point back at it through `killedByRosterId` / `killedByUserId`;
 * - survivor and zombie lists that leave it out identify it by elimination;
 * - infection, bashing and mauling events name it as an actor.
 *
 * So a hidden Whisperer is disguised as a Survivor, which is what the game's own copy promises
 * ("a Whisperer walks among you"). Pointers to it are nulled, and event actors keep their
 * "Whisperer" label but lose the user id and name. League-wide counts are left alone: they say a
 * Whisperer exists, which every member is already told.
 *
 * Pure: no database access.
 */

export const DISGUISED_WHISPERER_STATUS = 'Survivor'
export const HIDDEN_WHISPERER_NAME = 'The Whisperer'

export type WhispererIdentity = {
  rosterIds: ReadonlySet<string>
  userIds: ReadonlySet<string>
}

export function isWhispererStatus(status: unknown): boolean {
  return typeof status === 'string' && status.toLowerCase().includes('whisperer')
}

/** The identity with one more Whisperer roster id folded in (null is ignored). */
export function withWhispererRoster(identity: WhispererIdentity, rosterId: string | null | undefined): WhispererIdentity {
  if (!rosterId || identity.rosterIds.has(rosterId)) return identity
  return { rosterIds: new Set([...identity.rosterIds, rosterId]), userIds: identity.userIds }
}

function isWhispererRoster(identity: WhispererIdentity, rosterId: unknown, status?: unknown): boolean {
  return (typeof rosterId === 'string' && identity.rosterIds.has(rosterId)) || isWhispererStatus(status)
}

/** A team row as a viewer who may not know the Whisperer should see it. */
export function redactZombieTeam<T extends { rosterId: string; status?: string | null }>(
  team: T,
  identity: WhispererIdentity,
): T {
  const out: Record<string, unknown> = { ...team }
  if (isWhispererRoster(identity, team.rosterId, team.status)) {
    out.status = DISGUISED_WHISPERER_STATUS
    if ('isWhisperer' in out) out.isWhisperer = false
    if ('ambushesRemaining' in out) out.ambushesRemaining = 0
    if ('ambushesUsed' in out) out.ambushesUsed = 0
    if ('statusHistory' in out) out.statusHistory = null
  }
  if (typeof out.killedByRosterId === 'string' && identity.rosterIds.has(out.killedByRosterId)) {
    out.killedByRosterId = null
  }
  if (typeof out.killedByUserId === 'string' && identity.userIds.has(out.killedByUserId)) {
    out.killedByUserId = null
  }
  return out as T
}

export function redactStatusEntries<T extends { rosterId: string; status: string }>(
  entries: readonly T[],
  identity: WhispererIdentity,
): T[] {
  return entries.map((entry) =>
    isWhispererRoster(identity, entry.rosterId, entry.status)
      ? { ...entry, status: DISGUISED_WHISPERER_STATUS }
      : entry,
  )
}

/**
 * Survivor and zombie roster lists with the hidden Whisperer folded into the survivors. The
 * survivors come back sorted, so the Whisperer cannot be picked out by its position either.
 */
export function redactSurvivorAndZombieIds(
  lists: { survivors: readonly string[]; zombies: readonly string[] },
  identity: WhispererIdentity,
): { survivors: string[]; zombies: string[] } {
  const zombies = lists.zombies.filter((id) => !identity.rosterIds.has(id))
  const survivors = new Set(lists.survivors)
  for (const id of identity.rosterIds) survivors.add(id)
  return { survivors: [...survivors].sort(), zombies }
}

const EVENT_ACTORS: ReadonlyArray<{ userId: string; name?: string; statuses: readonly string[] }> = [
  { userId: 'infectorUserId', name: 'infectorName', statuses: ['infectorStatus'] },
  { userId: 'victimUserId', name: 'victimName', statuses: ['victimPriorStatus', 'victimNewStatus', 'victimStatus'] },
  { userId: 'winnerUserId', statuses: ['winnerStatus'] },
  { userId: 'loserUserId', statuses: ['loserStatus'] },
  { userId: 'maulerUserId', statuses: ['maulerStatus'] },
]

/** An infection, bashing or mauling event with any Whisperer actor made anonymous. */
export function redactZombieEvent<T extends object>(event: T, identity: WhispererIdentity): T {
  const out = { ...event } as Record<string, unknown>
  for (const actor of EVENT_ACTORS) {
    if (!(actor.userId in out)) continue
    const actorId = out[actor.userId]
    const isWhisperer =
      (typeof actorId === 'string' && identity.userIds.has(actorId)) ||
      actor.statuses.some((key) => isWhispererStatus(out[key]))
    if (!isWhisperer) continue
    out[actor.userId] = null
    if (actor.name && actor.name in out) out[actor.name] = HIDDEN_WHISPERER_NAME
  }
  if ('newWhispererUserId' in out) out.newWhispererUserId = null
  return out as T
}

/**
 * The WhispererRecord for a viewer who may not know it. The shape is kept (the league home reads
 * `ambushesRemaining` and `isPubliclyRevealed` from it); the identity is removed, and
 * `isPubliclyRevealed` is forced false. Returning `null` instead would be read by the league home
 * as "revealed" in a public league (`record?.isPubliclyRevealed ?? true`).
 */
export function redactWhispererRecord<T extends object>(record: T | null | undefined): T | null {
  if (!record) return null
  return { ...record, userId: null, displayName: null, isPubliclyRevealed: false } as T
}

/** A Zombie AI deterministic context with the Whisperer's identity removed. */
export function redactZombieAIContext<
  T extends {
    whispererRosterId: string | null
    statuses: { rosterId: string; status: string }[]
    survivors: string[]
    zombies: string[]
  },
>(ctx: T, identity: WhispererIdentity): T & { whispererHidden: boolean } {
  const merged = withWhispererRoster(identity, ctx.whispererRosterId)
  const lists = redactSurvivorAndZombieIds(ctx, merged)
  return {
    ...ctx,
    whispererRosterId: null,
    whispererHidden: merged.rosterIds.size > 0,
    statuses: redactStatusEntries(ctx.statuses, merged),
    survivors: lists.survivors,
    zombies: lists.zombies,
  }
}
