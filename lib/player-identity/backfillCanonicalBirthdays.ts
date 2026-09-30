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

export type SleeperBirthdayPromotionSummary = {
  /** Canonical players reachable through exactly one Sleeper identity. */
  considered: number
  /** Of those, Sleeper sent a real (well-formed, non-placeholder) birthday for. */
  available: number
  /** Had no birthday; Sleeper's written. */
  filled: number
  /** Had a DIFFERENT birthday; Sleeper's written over it. */
  corrected: number
  /** Already agreed. */
  alreadyCorrect: number
  /** Players reached by two Sleeper identities — skipped, never guessed. */
  skippedAmbiguous: number
}

/**
 * Promote SLEEPER's birthday onto the canonical player its Sleeper identity points at — and, unlike
 * `backfillCanonicalBirthdays`, CORRECT a birthday that disagrees with it.
 *
 * 🛑 WHY THIS ONE MAY OVERWRITE. Every canonical birthday so far came from TheSportsDB (the
 * backfill's default provider), and fill-only-never-overwrite froze its errors in place. Measured
 * 2026-09-30: against Rolling Insights, 19 of 625 comparable canonical birthdays disagree, and where
 * ESPN is a third witness it sides against TheSportsDB 5 times to 1. Some are typos (Justin Jefferson
 * 1999-01-16, true 1999-06-16; Josh Allen 03-21, true 05-21; Kyler Murray 08-27, true 08-07); others
 * are an OLDER same-named player's date (Devin Bush 1973, Jack Campbell 1958, Jacoby Jones 1984). A
 * wrong birthday is worse than none — the ESPN linker treats an agreeing birthday as near decisive,
 * so these made it refuse the right link for Jefferson, Allen and Murray on every run.
 *
 * Sleeper's date is authoritative HERE for one reason: the join is by id. A canonical player's Sleeper
 * identity IS Sleeper's player, so Sleeper's birthday is that player's birthday by definition — no
 * name, no inference. TheSportsDB reached the same player through its own identity row, which can
 * point at a namesake. Run this BEFORE the TheSportsDB fill, which then only reaches players Sleeper
 * sent no birthday for.
 *
 * ⚠ SAME RULES AS EVERY OTHER BIRTHDAY PATH: strict `YYYY-MM-DD` (`parseBirthday`), and a Jan-1
 * filler is never promoted (`isPlaceholderBirthday`) — a placeholder cannot correct anything.
 */
export async function promoteSleeperBirthdays(options?: {
  sport?: string
  maxWrites?: number
  isExhausted?: () => boolean
}): Promise<SleeperBirthdayPromotionSummary> {
  const sport = options?.sport ?? 'NFL'
  const maxWrites = options?.maxWrites ?? 2000
  const summary: SleeperBirthdayPromotionSummary = {
    considered: 0,
    available: 0,
    filled: 0,
    corrected: 0,
    alreadyCorrect: 0,
    skippedAmbiguous: 0,
  }

  const identities = await prisma.playerProviderIdentity
    .findMany({
      where: { provider: 'sleeper', sportKey: sport, playerId: { not: null } },
      select: { providerPlayerId: true, playerId: true },
    })
    .catch(() => [])

  /* One Sleeper id per player, or none: two would be two athletes, and either birthday could be wrong. */
  const sleeperIdByPlayer = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const i of identities) {
    if (!i.playerId || !i.providerPlayerId) continue
    if (sleeperIdByPlayer.has(i.playerId)) ambiguous.add(i.playerId)
    else sleeperIdByPlayer.set(i.playerId, i.providerPlayerId)
  }
  for (const pid of ambiguous) sleeperIdByPlayer.delete(pid)
  summary.skippedAmbiguous = ambiguous.size
  summary.considered = sleeperIdByPlayer.size
  if (sleeperIdByPlayer.size === 0) return summary

  /* Sleeper's OWN rows only — never a provider row stamped with the same Sleeper id. */
  const dobRows = await prisma.sportsPlayer
    .findMany({
      where: {
        source: 'sleeper',
        sport,
        sleeperId: { in: [...new Set(sleeperIdByPlayer.values())] },
        dob: { not: null },
      },
      select: { sleeperId: true, dob: true },
    })
    .catch(() => [])
  const dobBySleeperId = new Map<string, string>()
  const conflicting = new Set<string>()
  for (const r of dobRows) {
    const dob = r.dob?.trim()
    if (!r.sleeperId || !dob || isPlaceholderBirthday(dob) || !parseBirthday(dob)) continue
    const held = dobBySleeperId.get(r.sleeperId)
    /* Two Sleeper rows for one id that disagree (the bare and `sleeper:` formats): trust neither. */
    if (held && held !== dob) conflicting.add(r.sleeperId)
    else dobBySleeperId.set(r.sleeperId, dob)
  }
  for (const id of conflicting) dobBySleeperId.delete(id)

  const target = new Map<string, Date>()
  for (const [playerId, sleeperId] of sleeperIdByPlayer) {
    const dob = dobBySleeperId.get(sleeperId)
    const parsed = dob ? parseBirthday(dob) : null
    if (parsed) target.set(playerId, parsed)
  }
  summary.available = target.size
  if (target.size === 0) return summary

  const players = await prisma.player
    .findMany({ where: { id: { in: [...target.keys()] } }, select: { id: true, birthDate: true } })
    .catch(() => [])

  for (const player of players) {
    if (summary.filled + summary.corrected >= maxWrites) break
    if (options?.isExhausted?.()) break
    const birthDate = target.get(player.id)
    if (!birthDate) continue
    const held = player.birthDate ? player.birthDate.toISOString().slice(0, 10) : null
    if (held === birthDate.toISOString().slice(0, 10)) {
      summary.alreadyCorrect += 1
      continue
    }
    try {
      await prisma.player.update({
        where: { id: player.id },
        data: { birthDate, birthYear: birthDate.getUTCFullYear() },
      })
      if (held) summary.corrected += 1
      else summary.filled += 1
    } catch {
      /* One row must not cost the batch. */
    }
  }

  return summary
}
