/**
 * Prospect-stash policy: which sports may offer taxi squads and devy / prospect slots.
 *
 * A taxi squad or a prospect slot is only worth offering when there is a pool of not-yet-pro
 * players to put in it. For NFL that pool is college football (CFBD → `DevyPlayer`); for NBA it is
 * NCAAB. For NHL and MLB there is NONE: owner's decision 2026-10-20, after checking the committed
 * provider contracts —
 *
 *  - TheSportsDB's `all_leagues` fixture LISTS AHL / ECHL / OHL / WHL / QMJHL / USHL / NCAA hockey
 *    and Triple-A leagues, but the contract documents and captures no team or player roster for any
 *    of them, and its player shape has no draft, rights or parent-club field
 *    (`contracts/thesportsdb/GAPS.md` G-16). Our ingest pulls only NHL 4380 and MLB 4424.
 *  - Rolling Insights NHL / MLB are major-league only.
 *  - `ProspectPlayer` exists as a table, but no vendor is chosen and nothing writes it
 *    (`docs/DYNASTY_PROSPECT_DATA_PLAN.md`).
 *
 * So for NHL and MLB we stop OFFERING these on creation and on commissioner edits. This is
 * creation/write policy only: an existing NHL/MLB league that already has taxi or prospect slots keeps
 * them, keeps rendering them, and may keep or reduce them. Nothing here rewrites stored data.
 *
 * `NA` (MLB "not active") and `RESERVE` are deliberately NOT stash slots here: `NA` is a standard
 * redraft slot that holds players already in our MLB pool.
 *
 * ⚠ 2026-10-31: NHL ROOKIE DRAFTS NOW OFFER FANTRAX PROSPECTS (`lib/player-identity/nhlFantraxProspects.ts`),
 * and this gate was deliberately LEFT CLOSED. Since the same day the layer is also in NHL dynasty free
 * agency (`lib/waiver-wire/nhlProspectFreeAgency.ts`), but nothing reads it for taxi eligibility, and it
 * carries no age or draft year to tell a 19-year-old from an unsigned veteran, so a taxi rule could not
 * say who belongs on one. Open it here, for NHL only, when real age or draft data exists.
 *
 * ⚠ 2026-10-31: MLB ROOKIE DRAFTS NOW OFFER FANTRAX PROSPECTS TOO (`lib/player-identity/mlbFantraxProspects.ts`),
 * and the gate stays CLOSED for MLB for the same reason: the layer exists only on a rookie-draft board,
 * nothing reads it for taxi or minors eligibility, and it has no age, draft year or level to tell a
 * prospect from an unsigned veteran. Open it for MLB only when those exist.
 */

/** Sports with no committed prospect / minor-league player pool. */
export const SPORTS_WITHOUT_PROSPECT_POOL = ['NHL', 'MLB'] as const

/** Roster slots whose only purpose is stashing prospects. */
export const PROSPECT_STASH_SLOT_KEYS = ['TAXI', 'PROSPECT', 'RIGHTS', 'MINORS'] as const

/** Roster templates that exist only to carry a prospect stash (MLB `devy`, NHL `prospect`). */
const PROSPECT_ONLY_TEMPLATE_KEYS = new Set(['devy', 'prospect'])

const STASH_KEYS = new Set<string>(PROSPECT_STASH_SLOT_KEYS)

export const PROSPECT_STASH_UNAVAILABLE_MESSAGE =
  'Taxi squads and devy / prospect slots are not available for NHL or MLB leagues: we have no minor-league or prospect player pool for those sports.'

export const PROSPECT_STASH_UNAVAILABLE_CODE = 'PROSPECT_STASH_UNAVAILABLE_FOR_SPORT'

/** False for NHL and MLB. Unknown or empty sports are treated as supported (the old behaviour). */
export function sportSupportsProspectStash(sport: string | null | undefined): boolean {
  const s = String(sport ?? '').trim().toUpperCase()
  return !(SPORTS_WITHOUT_PROSPECT_POOL as readonly string[]).includes(s)
}

export function isProspectStashSlotKey(key: string): boolean {
  return STASH_KEYS.has(String(key).trim().toUpperCase())
}

/** Removes stash slots for a sport without a prospect pool; returns the input unchanged otherwise. */
export function stripProspectStashSlots<T extends Record<string, number>>(sport: string | null | undefined, slots: T): T {
  if (sportSupportsProspectStash(sport)) return slots
  const out: Record<string, number> = {}
  for (const [key, count] of Object.entries(slots)) {
    if (!isProspectStashSlotKey(key)) out[key] = count
  }
  return out as T
}

/**
 * Stash slots a commissioner write would ADD or GROW, for a sport without a prospect pool.
 * Keeping or reducing what a league already has is allowed, so existing leagues are never stuck.
 */
export function findAddedProspectStashSlots(
  sport: string | null | undefined,
  next: Record<string, unknown>,
  previous: Record<string, unknown> | null | undefined,
): string[] {
  if (sportSupportsProspectStash(sport)) return []
  const added: string[] = []
  for (const [key, raw] of Object.entries(next)) {
    if (!isProspectStashSlotKey(key)) continue
    const count = Number(raw)
    const before = Number(previous?.[key] ?? 0)
    if (Number.isFinite(count) && count > 0 && count > (Number.isFinite(before) ? before : 0)) added.push(key)
  }
  return added
}

/** True when a taxi-slot count change is not allowed: growing taxi for an NHL/MLB league. */
export function isTaxiIncreaseRefused(sport: string | null | undefined, next: number, previous: number): boolean {
  if (sportSupportsProspectStash(sport)) return false
  return Number.isFinite(next) && next > 0 && next > (Number.isFinite(previous) ? previous : 0)
}

/** Roster templates a commissioner may pick, with stash slots removed for NHL / MLB. */
export function filterRosterTemplatesForProspectPolicy<T extends { key: string; slots: Record<string, number> }>(
  sport: string | null | undefined,
  templates: readonly T[],
): T[] {
  if (sportSupportsProspectStash(sport)) return [...templates]
  return templates
    .filter((t) => !PROSPECT_ONLY_TEMPLATE_KEYS.has(t.key))
    .map((t) => ({ ...t, slots: stripProspectStashSlots(sport, t.slots) }))
}

/** Taxi and devy slots are reserved for long-term league formats. */
export function leagueSupportsTaxiDevy(input: { leagueType?: string | null; leagueVariant?: string | null; isDynasty?: boolean | null }): boolean {
  const types = [input.leagueType, input.leagueVariant].map(v => String(v ?? '').trim().toLowerCase().replace(/[- ]/g, '_'))
  if (types.some(v => v === 'zombie' || v.startsWith('zombie_'))) return false
  if (types.some(v => ['dynasty', 'devy', 'devy_dynasty', 'c2c', 'merged_devy_c2c', 'salary_cap', 'salary_cap_dynasty'].includes(v))) return true
  return types.every(v => !v) && Boolean(input.isDynasty)
}

export function isTaxiDevySlot(key: string): boolean {
  return ['TAXI', 'DEVY'].includes(String(key).trim().toUpperCase())
}
