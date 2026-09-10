/**
 * One resolver for `TeamPerformance.opponent`, written against what the PRODUCER stores.
 *
 * 🛑 THE COLUMN HOLDS A `LeagueTeam.id`, NOT A TEAM NAME — AND BOTH READERS ASSUMED A NAME.
 *
 * The only production writer is `SleeperLeagueCreationBootstrapService`, which stores the
 * OTHER side's primary key:
 *
 *     opponent: tid2 ?? undefined      // tid2 = teamIdByExternalId.get(mu.roster_id_2)
 *
 * `prisma/seed.ts` writes the literal string `"Opponent Team"`, which is where the
 * name-shaped reading came from — a fixture, mistaken for the contract.
 *
 * Consequences of resolving a UUID by name, both measured by reading the code:
 *
 *   1. `lib/ai-tools-start-sit/opponentMatchup.ts` matched with a BIDIRECTIONAL substring test
 *      (`teamName.includes(opponent) || opponent.includes(teamName)`). A UUID contains no team
 *      name and no team name contains a UUID, so the matchup-difficulty note never fired on real
 *      imported data at all.
 *   2. 🛑 WORSE, `(t.teamName ?? '')` MADE THE SECOND ARM MATCH EVERYTHING. Every string
 *      `.includes('')`, so a seat with a null or empty name matched EVERY opponent, and
 *      `Array.find` returned the first one. An unnamed seat therefore became the opponent of
 *      record for every manager in the league, and the screen printed a confident points-against
 *      ranking about the wrong team. Unclaimed seats are the most likely to be unnamed, and this
 *      branch newly RETAINS them instead of deleting them — so the population that triggers it
 *      grew.
 *
 * The rule this encodes: an identifier is resolved by the contract that produced it, and an
 * unresolved identifier resolves to NOTHING. Never to whatever happened to be first.
 */

export interface OpponentCandidate {
  id: string
  externalId?: string | null
  teamName?: string | null
}

export interface ResolveOpponentResult<T extends OpponentCandidate> {
  team: T | null
  /** How it resolved, for a caller that wants to say so in a note. */
  via: 'team_id' | 'external_id' | 'legacy_name' | 'unresolved'
}

/**
 * Resolve a stored `opponent` value to one of `teams`.
 *
 * Order is by descending certainty: the documented contract first, the provider key second, and
 * an EXACT (never substring) name only as a legacy fallback for rows written before the contract
 * settled — and for the seed.
 *
 * ⚠ AN EMPTY OR WHITESPACE-ONLY `teamName` IS NEVER A MATCH. That is the whole bug above.
 */
export function resolveTeamPerformanceOpponent<T extends OpponentCandidate>(
  opponent: string | null | undefined,
  teams: readonly T[],
  options?: { excludeTeamId?: string | null },
): ResolveOpponentResult<T> {
  const value = typeof opponent === 'string' ? opponent.trim() : ''
  if (!value) return { team: null, via: 'unresolved' }

  const eligible = options?.excludeTeamId
    ? teams.filter((t) => t.id !== options.excludeTeamId)
    : teams

  const byId = eligible.find((t) => t.id === value)
  if (byId) return { team: byId, via: 'team_id' }

  const byExternal = eligible.find((t) => (t.externalId ?? '') !== '' && t.externalId === value)
  if (byExternal) return { team: byExternal, via: 'external_id' }

  /*
   * Legacy/seed representation. EXACT, case-insensitive, and only against a team that actually
   * has a name — so an unnamed seat can never absorb an unresolved opponent.
   */
  const needle = value.toLowerCase()
  const byName = eligible.find((t) => {
    const name = (t.teamName ?? '').trim().toLowerCase()
    return name !== '' && name === needle
  })
  if (byName) return { team: byName, via: 'legacy_name' }

  return { team: null, via: 'unresolved' }
}
