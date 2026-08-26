/**
 * "What this defender actually does", derived from box scores rather than asserted.
 *
 * ⚠ THIS REPLACES A HASH OF THE PLAYER'S NAME. `app/idp/components/idpPositionUtils.ts` shipped
 * `idpRoleLabel`, which summed the character codes of the player id and returned "Run Stopper",
 * "Edge Rusher", "Coverage" or "Hybrid" from the remainder. It rendered beside real names and
 * read as analysis.
 *
 * A genuine archetype needs snap SPLITS — how many of a defender's snaps were coverage versus
 * run defence versus pass rush — and no provider we ingest carries them. So this does not label
 * an archetype at all. It states the rates we can actually derive and names the one we cannot,
 * because a manager reading "Coverage" would reasonably assume someone measured coverage.
 */

/** One derived line. `value: null` means we looked and could not say. */
export interface DefenderRoleLine {
  label: string
  value: string | null
  basis: string
}

export interface DefenderRoleResult {
  lines: DefenderRoleLine[]
  /** Defensive games that carried a snap count — the sample behind every line above. */
  games: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Derive the role lines from a defender's game logs.
 *
 * ⚠ THE HOUSE RULE INVERTS FOR EVENT STATS, AND GETTING IT BACKWARDS COSTS 88% OF THE BOARD.
 * Everywhere else in this codebase a missing key means "unknown, do not assume zero". Here it
 * does not: `idp_sack` is written only when a sack HAPPENED. Measured across 4,000 NFL game
 * rows, `idp_sack` appears on 128 while `def_snp` appears on 1,077 — so treating its absence as
 * unknown would refuse a sack rate for roughly seven of every eight defenders who played.
 *
 * The discriminator is the SNAP COUNT, not the event. A game with `def_snp` is a game we
 * watched: an absent event in it is a real zero. A game without `def_snp` is a game we have no
 * record of, and neither its events nor its zeros can be trusted — those are skipped entirely.
 */
export function deriveDefenderRole(
  statMaps: ReadonlyArray<unknown>,
): DefenderRoleResult {
  let snaps = 0
  let sacks = 0
  let tackles = 0
  let games = 0

  for (const raw of statMaps) {
    const m = (raw ?? {}) as Record<string, unknown>
    const snp = m.def_snp
    // No snap count means we cannot tell a zero from a blank, so the whole game is unusable.
    if (typeof snp !== 'number' || !(snp > 0)) continue

    games += 1
    snaps += snp

    const sack = m.idp_sack
    if (typeof sack === 'number') sacks += sack

    /*
     * `idp_tkl` is the combined total where it exists; older rows carry only the split columns.
     * Preferring the total avoids double-counting when a row happens to carry all three.
     */
    const total = m.idp_tkl
    if (typeof total === 'number') {
      tackles += total
    } else {
      const solo = m.idp_tkl_solo
      const ast = m.idp_tkl_ast
      if (typeof solo === 'number') tackles += solo
      if (typeof ast === 'number') tackles += ast
    }
  }

  if (games === 0) {
    return {
      games: 0,
      lines: [
        {
          label: 'Role',
          value: null,
          basis: 'no game on file carries a defensive snap count — refused rather than estimated',
        },
      ],
    }
  }

  const lines: DefenderRoleLine[] = []

  /*
   * Reported as "one per N snaps" rather than a percentage because the percentages involved are
   * fractions of one percent, and a reader cannot hold "0.4% of snaps" as a rate of anything.
   */
  lines.push(
    sacks > 0
      ? {
          label: 'Sack rate',
          value: `1 per ${round1(snaps / sacks)} defensive snaps`,
          basis: `${round1(sacks)} sacks over ${snaps} snaps, ${games} games`,
        }
      : {
          // A measured zero, stated as one. This is a finding, not a gap.
          label: 'Sack rate',
          value: `none in ${games} game${games === 1 ? '' : 's'}`,
          basis: `${snaps} defensive snaps, no sack recorded`,
        },
  )

  lines.push(
    tackles > 0
      ? {
          label: 'Tackle rate',
          value: `1 per ${round1(snaps / tackles)} defensive snaps`,
          basis: `${round1(tackles)} tackles over ${snaps} snaps, ${games} games`,
        }
      : {
          label: 'Tackle rate',
          value: null,
          basis: `${games} game${games === 1 ? '' : 's'} on file carry snaps but no tackle column`,
        },
  )

  /*
   * ⚠ NAMED, NOT OMITTED. The design this implements asked for "tackle share of team tackles"
   * and for targets allowed. Neither denominator exists: `normalizedStatMap` carries the
   * player's own `idp_tkl` but no team total, and no coverage-target column at all. Dropping
   * the row silently would leave the reader assuming nobody thought to look.
   */
  lines.push({
    label: 'Coverage',
    value: null,
    basis: 'no targets-allowed column is ingested by any provider we read',
  })

  return { lines, games }
}
