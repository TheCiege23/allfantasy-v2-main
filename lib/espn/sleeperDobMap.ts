/**
 * Compose `Player.id` → birthday out of two id-keyed reads. No matching.
 *
 * ⚠ THE BIRTHDAYS ARE NOT WHERE THE MATCHER WAS LOOKING. Measured on production
 * 2026-08-29: `Player(NFL)` carries a `birthDate` on 1,546 of 13,010 rows (12%),
 * while `SportsPlayer(NFL)` holds 15,777 of them. `matchProviderAthlete`'s own
 * header says the only birthday in this database is `SportsPlayer.dob`, and its
 * `dob?: string | Date` signature exists to accept that string — but the ESPN
 * linker built its candidate pool from `Player.birthDate` alone and so could
 * never corroborate.
 *
 * That matters because ESPN evidence is a name and a birthday and nothing else:
 * its athlete document has no position field, so a candidate with no birthday
 * can only ever be refused on name alone. Simulated over the real 1,226
 * unlinked rows, feeding these birthdays in takes links from 222 to 420 without
 * touching MIN_LINK_CONFIDENCE — a name on its own still never links.
 *
 * ⚠ A PURE MODULE, because the file that uses it imports prisma at module scope
 * and a unit test could not load it. Same reason as `descriptiveId.ts`.
 */

export type IdentityRow = {
  /** `Player.id`. Rows with none are ignored by the caller. */
  playerId: string | null
  /** For `provider: 'sleeper'` this IS the Sleeper player id. */
  providerPlayerId: string
}

export type DobRow = {
  sleeperId: string | null
  dob: string | null
}

/**
 * `Player.id` → birthday, for players reachable through one Sleeper identity.
 *
 * ⚠ A PLAYER WITH TWO SLEEPER IDENTITIES IS DROPPED, NOT GUESSED. Production
 * currently shows exactly one per player, but if that stops being true the two
 * rows point at different athletes, and taking whichever came back first would
 * hand the matcher a birthday belonging to somebody else. That is worse than no
 * birthday: a missing birthday produces a refusal, a wrong one produces a
 * confident wrong link into the table a live resolver reads.
 */
export function buildSleeperDobMap(
  identities: readonly IdentityRow[],
  dobRows: readonly DobRow[],
): Map<string, string> {
  const sleeperIdByPlayer = new Map<string, string>()
  const ambiguous = new Set<string>()

  for (const i of identities) {
    const pid = i.playerId
    if (!pid || !i.providerPlayerId) continue
    if (sleeperIdByPlayer.has(pid)) {
      ambiguous.add(pid)
      continue
    }
    sleeperIdByPlayer.set(pid, i.providerPlayerId)
  }
  for (const pid of ambiguous) sleeperIdByPlayer.delete(pid)

  const dobBySleeperId = new Map<string, string>()
  for (const r of dobRows) {
    const dob = r.dob?.trim()
    /* First wins: the caller reads these in one query with no ordering
       guarantee, so a duplicate must not silently flip the value between runs. */
    if (!r.sleeperId || !dob || dobBySleeperId.has(r.sleeperId)) continue
    dobBySleeperId.set(r.sleeperId, dob)
  }

  const out = new Map<string, string>()
  for (const [playerId, sleeperId] of sleeperIdByPlayer) {
    const dob = dobBySleeperId.get(sleeperId)
    if (dob) out.set(playerId, dob)
  }
  return out
}
