/**
 * How the free-agent screens place and describe NHL Fantrax prospects (NHL dynasty only — the
 * server sends none anywhere else; see lib/waiver-wire/nhlProspectFreeAgency.ts). Pure, so both
 * waiver screens and their tests share one rule.
 *
 * A prospect has no projection, ADP, rank or stats, so every value sort would put him among the
 * real players who also lack one, in an order that means nothing. They go after every real player
 * instead. Sorting by name, position or team is a lookup rather than a ranking, and there they mix in.
 */

export type ProspectAware = { id: string; prospectSource?: string | null }

export type NhlProspectListMeta = { total: number; listed: number }

/** Sorts under which prospects mix in with real players. */
const INTERLEAVED_SORTS = new Set(['name', 'position', 'team'])

export function isNhlProspectWireRow(p: { prospectSource?: string | null } | null | undefined): boolean {
  return p?.prospectSource === 'fantrax'
}

/** Stable: real players keep their order, prospects keep theirs, prospects last. */
export function placeProspectsAfterPlayers<T extends ProspectAware>(list: readonly T[], sort?: string | null): T[] {
  if (sort && INTERLEAVED_SORTS.has(sort)) return [...list]
  const players: T[] = []
  const prospects: T[] = []
  for (const p of list) (isNhlProspectWireRow(p) ? prospects : players).push(p)
  return [...players, ...prospects]
}

/** Search results from the server, added to the list without duplicating a row already there. */
export function mergeProspectSearchRows<T extends ProspectAware>(list: readonly T[], extra: readonly T[]): T[] {
  if (extra.length === 0) return [...list]
  const seen = new Set(list.map((p) => p.id))
  return [...list, ...extra.filter((p) => !seen.has(p.id) && isNhlProspectWireRow(p))]
}

export function parseNhlProspectListMeta(value: unknown): NhlProspectListMeta | null {
  if (!value || typeof value !== 'object') return null
  const { total, listed } = value as { total?: unknown; listed?: unknown }
  if (typeof total !== 'number' || typeof listed !== 'number') return null
  return { total, listed }
}

/** Only search the server when the list holds fewer prospects than exist, and the query is a name. */
export function shouldSearchNhlProspects(meta: NhlProspectListMeta | null, query: string): boolean {
  return Boolean(meta && meta.total > meta.listed && query.trim().length >= 2)
}
