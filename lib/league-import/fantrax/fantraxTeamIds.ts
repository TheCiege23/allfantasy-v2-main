/**
 * Fantrax team id → the numeric roster id the rest of the app requires.
 *
 * 🛑 WHY THIS EXISTS AT ALL: `WeeklyMatchup.rosterId` IS AN `Int`, AND EVERY
 * READER MAPS IT BACK WITH `Number(LeagueTeam.externalId)`.
 *
 * Fantrax team ids are alphanumeric (`qoat4t4imm8jp61g`), and this repo minted
 * `LeagueTeam.externalId` for them as `fantrax-team:<slug>`. `Number()` of that
 * is `NaN`, so `lib/core-app/weekBoard.ts` drops every Fantrax team out of both
 * `rosterNames` and `myRosters` without erroring — the scoreboard cannot name an
 * opponent or find your own team. Production evidence is quoted in
 * `ImportedLeagueCommitService`: `fantrax-team:ciege82=fantrax-user:Ciege82[claimed]`.
 *
 * Writing matchup rows under a slug id was never possible; writing them under an
 * INVENTED number would have been worse, because it renders a scoreboard where
 * every team is "roster 7".
 *
 * ⚠ HASHED, NOT INDEXED, AND THAT IS THE WHOLE DESIGN DECISION. The obvious
 * mapping — sort the league's teams and number them 1..N — is stable only while
 * the team SET is. Add a team, remove one, or import a league whose roster list
 * comes back in a different shape, and every id shifts by one: every historical
 * `WeeklyMatchup` row silently re-attributes to the wrong team, with no error and
 * no conflict. A hash of the team's own durable id depends on nothing but that
 * id, so a team keeps its number for the life of the league.
 *
 * ⚠ THE NAME IS THE FALLBACK, NOT THE KEY. Fantrax was a CSV upload before it
 * was an API client, and a CSV-era snapshot carries no Fantrax team ids at all —
 * only names. Those rows hash the normalized name instead, which is stable for a
 * snapshot that by definition never changes again. A live league always prefers
 * the real id, so a rename does not renumber it.
 */

/** Postgres `int4` tops out at 2147483647; stay well clear and never emit 0. */
const MODULUS = 2_000_000_000

/**
 * FNV-1a, 32-bit. Chosen because it is short enough to be obviously correct by
 * inspection and identical in every language — the backfill and the importer
 * MUST agree byte for byte, and a mismatch between them would renumber teams
 * rather than fail.
 */
export function fantraxTeamHash(key: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    /* >>> 0 keeps it unsigned; Math.imul keeps the multiply 32-bit. */
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % MODULUS) + 1
}

export type FantraxTeamKey = {
  /** Fantrax's own team id, when the snapshot carries one. */
  sourceTeamId?: string | null
  /** The team's display name — the only key a CSV-era snapshot has. */
  teamName: string
}

/**
 * Assign every team in one league a stable numeric id.
 *
 * ⚠ COLLISIONS ARE RESOLVED DETERMINISTICALLY, NOT IGNORED. Two 32-bit hashes
 * colliding inside a twelve-team league is vanishingly unlikely (~3e-8), but
 * "unlikely" applied across every league forever is not "never", and the failure
 * mode is two teams sharing a roster id — which reads as one team playing
 * itself. Probing forward from the hash keeps the mapping a pure function of the
 * key set, so the backfill and the importer land on the same answer.
 *
 * ⚠ ITERATION ORDER IS PINNED BY SORTING THE KEYS. Without that, two runs over
 * the same league could resolve a collision in opposite directions and swap two
 * teams' ids — the exact silent re-attribution the hash exists to prevent.
 */
export function assignFantraxTeamIds(teams: FantraxTeamKey[]): Map<string, number> {
  const keyed = teams
    .map((t) => {
      const source = String(t.sourceTeamId ?? '').trim()
      const name = normalizeFantraxTeamName(t.teamName)
      return { lookup: name, hashKey: source || name }
    })
    .filter((t) => t.lookup.length > 0)
    .sort((a, b) => (a.hashKey < b.hashKey ? -1 : a.hashKey > b.hashKey ? 1 : 0))

  const taken = new Set<number>()
  const out = new Map<string, number>()
  for (const t of keyed) {
    if (out.has(t.lookup)) continue
    let id = fantraxTeamHash(t.hashKey)
    while (taken.has(id)) id = (id % MODULUS) + 1
    taken.add(id)
    out.set(t.lookup, id)
  }
  return out
}

/**
 * The lookup key a team is stored under. Must match `buildTeamIdMap`'s
 * `normalizeTeamLabel` exactly — the two sit either side of the snapshot and a
 * drift between them looks like a team that vanished.
 */
export function normalizeFantraxTeamName(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Recognise the pre-numeric id this replaces.
 *
 * ⚠ USED BY THE BACKFILL TO DECIDE WHAT TO REWRITE, so it must not match a
 * number. A row that is already numeric has been migrated (or was written by the
 * new importer) and rewriting it again would be a second renumbering.
 */
export function isLegacyFantraxTeamId(externalId: string): boolean {
  return /^fantrax-team:/i.test(String(externalId ?? '').trim())
}
