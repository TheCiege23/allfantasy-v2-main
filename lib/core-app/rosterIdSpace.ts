import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { prisma } from '@/lib/prisma'

/**
 * Which player-id vocabulary a league's rosters speak, and the translation that
 * lets every Sleeper-id read in the Player Finder see through it.
 *
 * ⚠ ESPN ROSTERS ARE ESPN IDS, AND THE LINK TO OUR IDS ALREADY EXISTS. Measured on
 * production 2026-09-07: 263 distinct ESPN ids across the imported ESPN rosters,
 * 263 named in `sports_core_player_provider_identities`, 198 linked to a canonical
 * player, and 185 carried on `PlayerIdentityMap.espnId` next to a `sleeperId` —
 * written by `lib/espn/linkEspnIdentities.ts` from `/api/cron/import-players`.
 * Until now the Finder's rosters reads (`managerPresence`, `playerLeagueView`,
 * `playerFinder`, `playerSuggest`) scanned ESPN rosters for a Sleeper id, found
 * nothing, and the vocabulary guard correctly refused. Seventy percent of those
 * ids were resolvable one indexed read away. A day was spent believing the link
 * did not exist because `SportsPlayer` had no `source = 'espn'` rows — the wrong
 * table. See [[an-absence-is-only-as-good-as-where-you-looked]].
 *
 * WHAT THIS DOES: given a platform and its rosters, rewrite the roster ids (arrays
 * and `lineup_sections`) through `espnId → sleeperId`. An id with no mapping is
 * DROPPED (2026-09-29) — it used to be kept on the theory that it "fails every
 * Sleeper-id match honestly", and ESPN 12483 (Matthew Stafford) is Sleeper's 12483
 * (Jack Bech): a hit, not a miss. See `sleeperReadablePlayerData`. Sleeper and
 * manual leagues (AllFantasy's own id space IS Sleeper's) pass through untouched
 * with no query. `sleeperReadableRosters` is the one entry point for readers.
 *
 * 🛑 EVERY OTHER PLATFORM IS STRIPPED, NOT PASSED THROUGH (2026-09-27). This header
 * used to say a Yahoo/Fleaflicker/MFL/Fantrax roster "passes through untouched and
 * stays refused by the guard". It did not stay refused: those ids are NUMBERS in
 * Sleeper's range — 44 of the 248 on the one production Fleaflicker league ARE real
 * Sleeper ids — and every guard downstream only examines a MISS, while a collision
 * is a HIT. So the Trades value cards, portfolio insights, Season Outlook and the
 * finder's search chips named, priced and advised on the wrong players. A foreign
 * roster now contributes NO ids (`stripForeignIds`): every reader sees it as
 * unreadable and says so, which is true. The Player Finder, the one reader built
 * to tell "not here" from "cannot see", reads such leagues through the identity
 * bridge itself (bridgedRosterIds.ts) before it ever calls this.
 *
 * WHAT THIS DOES NOT DO: write anything, or guess. The identity chain is the
 * import pipeline's job; this only reads what it has already verified.
 */

export type RosterIdSpace = 'sleeper' | 'espn' | 'other'

export const ROSTER_KEYS = ['players', 'starters', 'reserve', 'taxi'] as const

export function rosterIdSpaceOf(platform: string | null | undefined): RosterIdSpace {
  const p = (platform ?? '').trim().toLowerCase()
  if (p === 'espn') return 'espn'
  // Native leagues speak Sleeper ids. `isNativePlatform` owns the native spellings (allfantasy, af,
  // manual, native); a local copy of that list once omitted `af` and `native` and would have
  // stripped a native league's roster as foreign.
  if (p === '' || p === 'sleeper' || isNativePlatform(p)) return 'sleeper'
  return 'other'
}

/**
 * THE rule: this league's roster ids must never be read as Sleeper ids. One predicate so the
 * translators, the crosswalk callers, the rail and the search counts cannot disagree about it.
 */
export function isForeignIdSpace(platform: string | null | undefined): boolean {
  return rosterIdSpaceOf(platform) === 'other'
}

/**
 * Every roster-id-bearing key, including those the ESPN translation never touched. `bench` is here
 * because `myRoster.rosterPlayerIds` reads a top-level `bench` array; no importer is known to write
 * one, but a reader that looks for it must never find a foreign id there.
 */
const STRIPPED_ARRAY_KEYS: readonly string[] = [...ROSTER_KEYS, 'ir', 'devy', 'bench']

/**
 * A foreign roster with every player id removed: the roster arrays, `ir`, `devy`, and each
 * `lineup_sections` section emptied. Other keys are untouched. See the header for why a foreign id
 * must never survive to a Sleeper-id read.
 */
export function stripForeignIds(playerData: unknown): Record<string, unknown> {
  const pd = (playerData ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...pd }
  for (const key of STRIPPED_ARRAY_KEYS) if (Array.isArray(pd[key])) out[key] = []
  for (const sectionsKey of ['lineup_sections', 'lineupSections']) {
    const sections = pd[sectionsKey]
    if (!sections || typeof sections !== 'object' || Array.isArray(sections)) continue
    out[sectionsKey] = Object.fromEntries(
      Object.entries(sections as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? [] : v]),
    )
  }
  return out
}

/**
 * A roster's `playerData` as a Sleeper-id reader may see it WITHOUT A READ: a Sleeper or native
 * league's returned as is (same object, no copy), every other league's ids stripped. An array-shaped
 * `playerData` (the IDP parsers' form) from such a league becomes `[]`.
 *
 * 🛑 ESPN IS STRIPPED HERE TOO, AND THAT IS THE FIX, NOT A LOSS (2026-09-29). This used to pass an
 * ESPN roster through untouched on the claim that "an ESPN id is long and collides with nothing". It
 * does collide: 17 ESPN ids in `PlayerIdentityMap` equal a DIFFERENT player's Sleeper id, and one of
 * them was on production rosters that day — ESPN 12483 is Matthew Stafford, on 8 ESPN leagues'
 * rosters, and Sleeper 12483 is Jack Bech. Every reader of this function named, priced, injured and
 * valued Jack Bech for Stafford, and — Stafford's real id never appearing — offered Stafford himself
 * as a free agent. The ESPN ids that collide with nothing matched nothing either, so the surfaces
 * were already empty for ESPN; stripping keeps them empty and makes them never wrong.
 *
 * To READ an ESPN roster, translate it: `sleeperReadableRosters` below, which is async because
 * translation is one indexed read.
 */
export function sleeperReadablePlayerData(platform: string | null | undefined, playerData: unknown): unknown {
  if (rosterIdSpaceOf(platform) === 'sleeper') return playerData
  return Array.isArray(playerData) ? [] : stripForeignIds(playerData)
}

/** Every distinct id across the roster arrays, as strings. */
export function collectRosterIds(playerDatas: readonly unknown[]): string[] {
  const seen = new Set<string>()
  for (const raw of playerDatas) {
    const pd = (raw ?? {}) as Record<string, unknown>
    for (const key of ROSTER_KEYS) {
      const arr = pd[key]
      if (!Array.isArray(arr)) continue
      for (const x of arr) {
        if (x == null) continue
        const id = String(x)
        if (id) seen.add(id)
      }
    }
  }
  return [...seen]
}

/** The id a `lineup_sections` entry carries: the entry itself when it is an id, else its `id`. */
function sectionEntryId(entry: unknown): string {
  if (typeof entry === 'string' || typeof entry === 'number') return String(entry)
  if (entry && typeof entry === 'object') return String((entry as { id?: unknown }).id ?? '')
  return ''
}

/**
 * Every distinct id an ESPN roster can carry — the roster arrays, `ir`/`devy`/`bench`, and every
 * `lineup_sections` entry — so the map is asked about each id `translatePlayerData` will rewrite.
 */
function collectTranslatableIds(playerDatas: readonly unknown[]): string[] {
  const seen = new Set<string>()
  for (const raw of playerDatas) {
    const pd = (raw ?? {}) as Record<string, unknown>
    for (const key of STRIPPED_ARRAY_KEYS) {
      const arr = pd[key]
      if (Array.isArray(arr)) for (const x of arr) if (x != null && String(x)) seen.add(String(x))
    }
    for (const sectionsKey of ['lineup_sections', 'lineupSections']) {
      const sections = pd[sectionsKey]
      if (!sections || typeof sections !== 'object' || Array.isArray(sections)) continue
      for (const v of Object.values(sections as Record<string, unknown>)) {
        if (Array.isArray(v)) for (const e of v) { const id = sectionEntryId(e); if (id) seen.add(id) }
      }
    }
  }
  return [...seen]
}

/**
 * An ESPN roster rewritten into Sleeper ids through `map` (ESPN id → Sleeper id): every roster array
 * (`players`/`starters`/`reserve`/`taxi`/`ir`/`devy`/`bench`) and every `lineup_sections` entry.
 * Keys that are not roster-id-bearing are untouched; a `null` hole stays a hole.
 *
 * 🛑 AN ID WITH NO MAPPING IS DROPPED, NOT KEPT. It was kept on the theory that it "fails every
 * Sleeper-id match honestly". It does not: ESPN 12483 (Matthew Stafford, unmapped or not) IS
 * Sleeper's 12483, Jack Bech, and a kept id is a hit, not a miss — every guard downstream only
 * examines a miss. An ESPN id is only a Sleeper id once the identity map says whose.
 * (`gameDayTriageLoader`, `playerShares` and `playerSharesLeague` already dropped them this way.)
 */
export function translatePlayerData(playerData: unknown, map: ReadonlyMap<string, string>): Record<string, unknown> {
  const pd = (playerData ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...pd }
  for (const key of STRIPPED_ARRAY_KEYS) {
    const arr = pd[key]
    if (!Array.isArray(arr)) continue
    out[key] = arr.flatMap((x) => {
      if (x == null) return [x]
      const sid = map.get(String(x))
      return sid ? [sid] : []
    })
  }
  for (const sectionsKey of ['lineup_sections', 'lineupSections']) {
    const sections = pd[sectionsKey]
    if (!sections || typeof sections !== 'object' || Array.isArray(sections)) continue
    out[sectionsKey] = Object.fromEntries(
      Object.entries(sections as Record<string, unknown>).map(([k, v]) => {
        if (!Array.isArray(v)) return [k, v]
        return [
          k,
          v.flatMap((e) => {
            const sid = map.get(sectionEntryId(e))
            if (!sid) return []
            return [e && typeof e === 'object' ? { ...(e as Record<string, unknown>), id: sid } : sid]
          }),
        ]
      }),
    )
  }
  return out
}

/** `espnId → sleeperId` for the ids given, from rows that carry both. One indexed read. */
export async function loadEspnToSleeperMap(espnIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(espnIds.filter(Boolean))]
  if (ids.length === 0) return out
  const rows = await prisma.playerIdentityMap
    .findMany({
      where: { espnId: { in: ids }, sleeperId: { not: null } },
      select: { espnId: true, sleeperId: true },
    })
    .catch(() => [] as Array<{ espnId: string | null; sleeperId: string | null }>)
  for (const r of rows) {
    if (r.espnId && r.sleeperId && !out.has(r.espnId)) out.set(r.espnId, r.sleeperId)
  }
  return out
}

export type TranslatedRosters<T> = {
  rosters: T[]
  idSpace: RosterIdSpace
  /** Distinct ids the rosters held. */
  total: number
  /** How many of them were rewritten to a Sleeper id. */
  translated: number
}

/** One league's rosters, translated when the platform needs it. No query for Sleeper-id leagues. */
export async function translateRostersToSleeperIds<T extends { playerData: unknown }>(
  platform: string | null | undefined,
  rosters: readonly T[],
): Promise<TranslatedRosters<T>> {
  const idSpace = rosterIdSpaceOf(platform)
  if (idSpace === 'other') {
    // Counted, never read: a foreign id surviving to a Sleeper-id lookup IS the collision.
    return {
      rosters: rosters.map((r) => ({ ...r, playerData: stripForeignIds(r.playerData) })),
      idSpace,
      total: collectRosterIds(rosters.map((r) => r.playerData)).length,
      translated: 0,
    }
  }
  if (idSpace !== 'espn' || rosters.length === 0) return { rosters: [...rosters], idSpace, total: 0, translated: 0 }
  const ids = collectRosterIds(rosters.map((r) => r.playerData))
  // Asked about every id `translatePlayerData` rewrites (sections too), or an unasked id is dropped.
  const map = await loadEspnToSleeperMap(collectTranslatableIds(rosters.map((r) => r.playerData)))
  let translated = 0
  for (const id of ids) if (map.has(id)) translated += 1
  return {
    rosters: rosters.map((r) => ({ ...r, playerData: translatePlayerData(r.playerData, map) })),
    idSpace,
    total: ids.length,
    translated,
  }
}

/**
 * 🛑 THE ONE WAY TO READ ROSTERS AS SLEEPER IDS. Every roster comes back in Sleeper's id space or
 * with no ids at all:
 *
 *   - Sleeper and native leagues    as is (same object, no copy, no read)
 *   - ESPN                          translated through `PlayerIdentityMap.espnId → sleeperId`, ids
 *                                   with no mapping DROPPED (see `translatePlayerData`)
 *   - every other platform          stripped (see the header and `stripForeignIds`)
 *
 * ONE indexed read covers every ESPN roster passed, whatever the mix of leagues. `platform` is the
 * league's platform when every roster is from one league, or a function giving each roster's.
 *
 * Use this, not `sleeperReadablePlayerData`, wherever the caller can await: that one cannot read the
 * identity map, so it must strip ESPN, and an ESPN manager then sees an empty surface.
 * ⚠ And never pass this function's output back through `sleeperReadablePlayerData` — it would strip
 * the translated ESPN roster it was just handed.
 */
export async function sleeperReadableRosters<T extends { playerData: unknown }>(
  rosters: readonly T[],
  platform: string | null | undefined | ((roster: T) => string | null | undefined),
): Promise<T[]> {
  return (await sleeperReadableRostersWithGaps(rosters, platform)).rosters
}

/**
 * `sleeperReadableRosters`, plus the ESPN ids it DROPPED because the identity map could not place
 * them.
 *
 * 🛑 FOR A READER THAT SUBTRACTS, A DROPPED ID IS NOT "NOBODY". Dropping is right for naming — an
 * untranslated ESPN id read as a Sleeper id names a stranger (ESPN 12483 is Matthew Stafford; Sleeper
 * 12483 is Jack Bech). But it is still a player on somebody's roster, and a reader deciding who is
 * AVAILABLE (a waiver pool) would offer him. Measured 2026-09-29: 83 of 271 ESPN roster ids do not
 * translate, and beside ~25 team defenses they include Justin Jefferson, Josh Allen, A.J. Brown and
 * Kyler Murray. Such a reader must account for these ids itself — see `lib/decision-os/waiver/pool.ts`.
 */
export async function sleeperReadableRostersWithGaps<T extends { playerData: unknown }>(
  rosters: readonly T[],
  platform: string | null | undefined | ((roster: T) => string | null | undefined),
): Promise<{ rosters: T[]; untranslatedEspnIds: string[] }> {
  const platformOf = typeof platform === 'function' ? platform : () => platform
  const spaceOf = rosters.map((r) => rosterIdSpaceOf(platformOf(r)))
  const espnIds = collectTranslatableIds(rosters.filter((_, i) => spaceOf[i] === 'espn').map((r) => r.playerData))
  const map = espnIds.length > 0 ? await loadEspnToSleeperMap(espnIds) : new Map<string, string>()
  return {
    rosters: rosters.map((r, i) => {
      if (spaceOf[i] === 'sleeper') return r
      if (Array.isArray(r.playerData)) return { ...r, playerData: [] }
      return { ...r, playerData: spaceOf[i] === 'espn' ? translatePlayerData(r.playerData, map) : stripForeignIds(r.playerData) }
    }),
    untranslatedEspnIds: espnIds.filter((id) => id !== '0' && !map.has(id)),
  }
}

/** One roster's `playerData`, through `sleeperReadableRosters`. For a loop, pass the rosters at once. */
export async function sleeperReadablePlayerDataOf(platform: string | null | undefined, playerData: unknown): Promise<unknown> {
  return (await sleeperReadableRosters([{ playerData }], platform))[0]!.playerData
}

/**
 * Rosters spanning many leagues, by league — `sleeperReadableRosters` keyed on `leagueId`.
 * Rosters of leagues absent from `platformByLeague` are treated as Sleeper-id rosters.
 */
export async function translateRostersByLeague<T extends { leagueId: string; playerData: unknown }>(
  rosters: readonly T[],
  platformByLeague: ReadonlyMap<string, string | null | undefined>,
): Promise<T[]> {
  return sleeperReadableRosters(rosters, (r) => platformByLeague.get(r.leagueId))
}
