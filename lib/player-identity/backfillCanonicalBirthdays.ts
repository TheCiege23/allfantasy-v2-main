/**
 * Give canonical players a birthday, so identity matching has something to check.
 *
 * ⚠ WHY THIS EXISTS. `matchProviderAthlete` treats an agreeing birthday as near
 * decisive and refuses to link on a name alone. Measured 2026-08-27, that rule was
 * inert: `Player.birthDate` and `Player.birthYear` were populated on ZERO rows in
 * every sport, and `PlayerIdentityMap.dob` likewise. The first production run of the
 * ESPN linker refused all 157 candidates it considered — correctly, because ESPN
 * supplies a birthday and we had nothing to compare it against.
 *
 * ⚠ IT TRAVELS BY ID, AND THAT IS THE WHOLE POINT. The birthday is read from
 * `SportsPlayer` and attached to the `Player` that a PROVIDER IDENTITY ROW already
 * points at — `providerPlayerId` = `externalId`, an exact id join, verified at
 * 1,784/1,784 for thesportsdb NFL. It is never resolved through a name.
 *
 * Taking it through a name join would be circular in a way that is easy to miss and
 * fatal to the matcher: a birthday derived by matching names, then used to
 * corroborate a name match, launders a name match into a "birthday-verified" one. It
 * would report 0.95 confidence for precisely the guess the matcher exists to refuse.
 *
 * ⚠ JANUARY 1 IS EXCLUDED, MEASURED NOT ASSUMED. Across 2,023 well-formed
 * thesportsdb NFL birthdays, Jan-1 dates average 3.17 players per date against 1.34
 * for every other day, and `2001-01-01` alone carries 8. That is a filler value, and
 * a filler birthday is worse than no birthday here: eight players "agreeing" on it
 * would hand the matcher eight 0.95-confidence links between different people. The
 * exclusion costs at most 19 rows, some of them genuine Jan-1 births. That trade is
 * only correct because an agreeing birthday is near decisive — it is the same reason
 * the rule is worth having at all.
 */

import { prisma } from '@/lib/prisma'

export type BirthdayBackfillSummary = {
  provider: string
  /** Identity rows examined — linked to a canonical player, for this provider. */
  considered: number
  /** Had a well-formed, non-placeholder birthday available. */
  available: number
  written: number
  skippedPlaceholder: number
  skippedMalformed: number
  /** Already had a birthday; never overwritten. */
  skippedAlreadySet: number
}

/*
 * ⚠ MOVED TO `birthdayRules.ts`, RE-EXPORTED HERE SO NOTHING BREAKS. Both rules
 * are now shared with `lib/espn/sleeperDobMap.ts`, which feeds the same
 * birthdays to the same matcher at link time and must apply the same Jan-1
 * exclusion — a second copy that drifted would mean two callers disagreeing
 * about which birthdays are real. That module cannot import from this one,
 * because this file pulls prisma at module scope.
 *
 * The rules themselves, and the measurements behind them, are unchanged.
 */
import { parseBirthday, isPlaceholderBirthday } from './birthdayRules'

export { parseBirthday, isPlaceholderBirthday }

/**
 * Copy birthdays from a provider's `SportsPlayer` rows onto the canonical players
 * their identity rows already point at.
 *
 * Bounded and resumable: only rows still missing a birthday are written, so a partial
 * run simply leaves a shorter list for the next one. Never overwrites.
 */
export async function backfillCanonicalBirthdays(options?: {
  provider?: string
  sport?: string
  maxWrites?: number
  isExhausted?: () => boolean
}): Promise<BirthdayBackfillSummary> {
  const provider = options?.provider ?? 'thesportsdb'
  const sport = options?.sport ?? 'NFL'
  const maxWrites = options?.maxWrites ?? 1000

  const summary: BirthdayBackfillSummary = {
    provider,
    considered: 0,
    available: 0,
    written: 0,
    skippedPlaceholder: 0,
    skippedMalformed: 0,
    skippedAlreadySet: 0,
  }

  const [identities, sourceRows] = await Promise.all([
    prisma.playerProviderIdentity
      .findMany({
        where: { provider, sportKey: sport, playerId: { not: null } },
        select: { providerPlayerId: true, playerId: true },
      })
      .catch(() => []),
    prisma.sportsPlayer
      .findMany({
        where: { source: provider, sport, dob: { not: null } },
        select: { externalId: true, dob: true },
      })
      .catch(() => []),
  ])
  summary.considered = identities.length
  if (identities.length === 0 || sourceRows.length === 0) return summary

  /* Keyed on the provider's own id — never on a name. */
  const dobByExternalId = new Map(sourceRows.map((r) => [r.externalId, r.dob]))

  const pending = new Map<string, Date>()
  for (const identity of identities) {
    if (!identity.playerId) continue
    const raw = dobByExternalId.get(identity.providerPlayerId)
    if (raw == null) continue
    if (isPlaceholderBirthday(raw)) {
      summary.skippedPlaceholder += 1
      continue
    }
    const parsed = parseBirthday(raw)
    if (!parsed) {
      summary.skippedMalformed += 1
      continue
    }
    /* First id wins. Two identity rows pointing at one player with different
       birthdays is a data problem to surface, not to resolve by overwriting. */
    if (!pending.has(identity.playerId)) pending.set(identity.playerId, parsed)
  }
  summary.available = pending.size
  if (pending.size === 0) return summary

  /* Only players still missing one. Asked in bulk rather than per row, and it also
     keeps `skippedAlreadySet` honest rather than inferred from update counts. */
  const missing = await prisma.player
    .findMany({
      where: { id: { in: [...pending.keys()] }, birthDate: null },
      select: { id: true },
    })
    .catch(() => [])
  summary.skippedAlreadySet = pending.size - missing.length

  for (const player of missing) {
    if (summary.written >= maxWrites) break
    if (options?.isExhausted?.()) break
    const birthDate = pending.get(player.id)
    if (!birthDate) continue
    try {
      await prisma.player.update({
        where: { id: player.id },
        /* `birthYear` is written alongside because it is the cheaper filter for a
           coarse candidate narrowing, and leaving the two to drift apart would give
           two answers to one question. */
        data: { birthDate, birthYear: birthDate.getUTCFullYear() },
      })
      summary.written += 1
    } catch {
      /* One row must not cost the batch. */
    }
  }

  return summary
}
