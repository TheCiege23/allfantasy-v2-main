import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The two pieces of per-league state the format notes were missing.
 *
 * Both were named as gaps at the call site rather than guessed at, which was
 * the right call — and both turn out to be reachable, one from a schema that
 * already existed and one from a JSON column that needs no migration.
 */

/* ── Survivor tribes ───────────────────────────────────────────────────────
 *
 * ⚠ `SurvivorTribe` AND `SurvivorTribeMember` ALREADY EXISTED. The
 * tribemate-versus-rival distinction — the single largest factor in a pre-merge
 * Survivor trade — was absent from the verdict because nothing read them, not
 * because the data was missing.
 */

export type TribeRelationState = {
  relation: 'tribemate' | 'rival' | 'post-merge' | 'unknown'
  yourTribe: string | null
  theirTribe: string | null
}

export async function resolveTribeRelation(args: {
  leagueId: string
  /** `Roster.id` of the viewer, and of the counterparty. */
  yourRosterId: string | null
  theirRosterId: string | null
}): Promise<TribeRelationState> {
  const unknown: TribeRelationState = { relation: 'unknown', yourTribe: null, theirTribe: null }
  if (!args.yourRosterId || !args.theirRosterId) return unknown

  const tribes = await prisma.survivorTribe
    .findMany({
      where: { leagueId: args.leagueId },
      select: {
        id: true,
        name: true,
        isMerged: true,
        isActive: true,
        members: { select: { rosterId: true } },
      },
    })
    .catch(() => [])
  if (tribes.length === 0) return unknown

  /*
   * ⚠ AFTER THE MERGE THERE ARE NO TRIBEMATES, and the cooperative logic must
   * switch off rather than quietly reporting everyone as an ally. A merged tribe
   * containing both managers would otherwise read as "tribemate" and advise a
   * losing trade in the one phase where every point handed over works against
   * you.
   */
  if (tribes.some((t) => t.isMerged)) {
    return { relation: 'post-merge', yourTribe: null, theirTribe: null }
  }

  const tribeOf = (rosterId: string) =>
    tribes.find((t) => t.members.some((m) => m.rosterId === rosterId)) ?? null

  const mine = tribeOf(args.yourRosterId)
  const theirs = tribeOf(args.theirRosterId)
  if (!mine || !theirs) return unknown

  return {
    relation: mine.id === theirs.id ? 'tribemate' : 'rival',
    yourTribe: mine.name,
    theirTribe: theirs.name,
  }
}

/* ── Pirate protections ────────────────────────────────────────────────────
 *
 * ⚠ STORED IN `Roster.settings`, DELIBERATELY, RATHER THAN IN A NEW TABLE. That
 * column is already the home for commissioner flags, it is JSON, and using it
 * needs no migration. Adding a table for a house rule would mean a production
 * migration for something two leagues use, and this repo has a documented
 * history of migrations going wrong on prod.
 *
 * ⚠ AND AN ABSENT LIST IS NOT AN EMPTY ONE. A roster with no `protectedPlayers`
 * key has not declared protections; a roster with `[]` has declared none. The
 * first must not produce "everything you own is exposed", which is a confident
 * and alarming claim about a manager who simply has not used the feature.
 */

export type ProtectionState = {
  /** Sleeper ids the manager has shielded. Null means never declared. */
  protectedIds: string[] | null
  basis: string | null
}

/** Keys accepted on `Roster.settings`, tolerantly. */
const PROTECTION_KEYS = ['protectedPlayers', 'protectedPlayerIds', 'protected']

export async function readProtections(args: {
  leagueId: string
  platformUserId: string | null
}): Promise<ProtectionState> {
  if (!args.platformUserId) return { protectedIds: null, basis: null }

  const roster = await prisma.roster
    .findFirst({
      where: { leagueId: args.leagueId, platformUserId: args.platformUserId },
      select: { settings: true },
    })
    .catch(() => null)
  if (!roster) return { protectedIds: null, basis: null }

  const settings = (roster.settings ?? {}) as Record<string, unknown>
  const key = PROTECTION_KEYS.find((k) => Array.isArray(settings[k]))
  if (!key) {
    return {
      protectedIds: null,
      basis:
        'No protections are on file for this roster. That is not the same as protecting nobody — until they are declared, we cannot say which players are exposed.',
    }
  }

  const ids = (settings[key] as unknown[])
    .map((x) => String(x))
    .filter((x) => x && x !== '0')

  return {
    protectedIds: ids,
    basis:
      ids.length === 0
        ? 'This roster has declared no protected players, so every player on it can be taken by anyone who beats you.'
        : null,
  }
}
