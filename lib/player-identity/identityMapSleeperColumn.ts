/**
 * Which `PlayerIdentityMap` column holds a Sleeper id, for a sport — and how to read it.
 *
 * 🛑 SLEEPER NUMBERS EACH SPORT SEPARATELY, AND THIS TABLE KEEPS THEM IN DIFFERENT COLUMNS.
 * `sleeperId` holds NFL Sleeper ids (globally `@unique`); NBA Sleeper ids live in `sleeperNbaId`
 * (unique per `(sport, sleeperNbaId)`). The numbers collide: NFL 1466 is Travis Kelce and NBA 1466
 * is JaVale McGee, NFL 4866 Saquon Barkley / NBA 4866 AJ Dybantsa, NFL 4984 Josh Allen / NBA 4984
 * Cameron Corhen. So an NBA caller that hands its ids to `where: { sleeperId: { in } }` gets NFL
 * players back — one row each, no duplicate to warn anybody, simply the wrong person.
 *
 * Every read here therefore names the sport AND picks that sport's column. A sport with no Sleeper
 * column (or no sport at all) gets `null`, and the caller must look nothing up: an unnamed player is
 * honest, a stranger from another sport is not.
 *
 * PURE — no prisma, safe to import anywhere.
 */

export type IdentitySleeperColumn = 'sleeperId' | 'sleeperNbaId'

const SLEEPER_COLUMN_BY_SPORT: Readonly<Record<string, IdentitySleeperColumn>> = {
  NFL: 'sleeperId',
  NBA: 'sleeperNbaId',
}

/** The column a sport's Sleeper ids are written in, or null when that sport has none / is unknown. */
export function identitySleeperColumn(sport: string | null | undefined): IdentitySleeperColumn | null {
  const s = String(sport ?? '').trim().toUpperCase()
  return SLEEPER_COLUMN_BY_SPORT[s] ?? null
}

/**
 * `PlayerIdentityMap` filter for these Sleeper ids in this sport: `{ sport, <column>: { in: ids } }`.
 * `null` when the sport has no Sleeper column or there are no ids — the caller then reads nothing.
 */
export function identityMapSleeperWhere(
  ids: readonly (string | null | undefined)[],
  sport: string | null | undefined,
): { sport: string; sleeperId?: { in: string[] }; sleeperNbaId?: { in: string[] } } | null {
  const column = identitySleeperColumn(sport)
  if (!column) return null
  const clean = [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))]
  if (clean.length === 0) return null
  return { sport: String(sport).trim().toUpperCase(), [column]: { in: clean } }
}

/** The Sleeper id a row carries for `sport` — read back from the column the filter used. */
export function identityMapSleeperIdOf(
  row: { sleeperId?: string | null; sleeperNbaId?: string | null },
  sport: string | null | undefined,
): string | null {
  const column = identitySleeperColumn(sport)
  if (!column) return null
  const v = row[column]
  return v ? String(v) : null
}

/** A `select` that brings back both Sleeper columns, so `identityMapSleeperIdOf` can read either. */
export const IDENTITY_SLEEPER_SELECT = { sport: true, sleeperId: true, sleeperNbaId: true } as const
