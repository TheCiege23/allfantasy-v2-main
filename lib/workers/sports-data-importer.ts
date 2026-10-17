import 'server-only'

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { currentSeasonReportWhere } from '@/lib/injuries/injuryRecency'
import { createInjuryRowMatcher, isInjuryDesignation } from '@/lib/injuries/matchInjuryRows'
import { isStoredInjuryDesignation, storedInjuryFields } from '@/lib/injuries/storedInjuryDesignation'
import { rosterDesignation } from '@/lib/injuries/rosterDesignation'
import { SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import {
  assertTeamCodeFits,
  normalizePlayerName,
  normalizePositionForSport,
  normalizeTeamCode,
  type TeamCodeNormalization,
} from '@/lib/team-abbrev'
import { apiChain } from '@/lib/workers/api-chain'
import {
  collapseSeedsByIdentity,
  countNamesakes,
  createSeedValueBinder,
  pickLatestSeasonRow,
} from '@/lib/workers/sports-data-importer-binding'
import { COLLEGE_PAGED_SPORTS, SPORTS_PLAYER_TTL_MS } from '@/lib/workers/sports-player-record-freshness'

const UPSERT_BATCH_SIZE = 100

export { isStoredInjuryDesignation }

/**
 * DEFAULT wall-clock budget for the whole import, kept under the route's `maxDuration = 300`.
 * The margin leaves room for the per-sport stale-fallback write to land after we stop.
 *
 * 🛑 A CALLER THAT HAS PHASES OF ITS OWN MUST PASS `budgetMs` INSTEAD OF ACCEPTING THIS.
 *
 * This default is the SAME NUMBER as `CRON_RUN_BUDGET_MS` (240s), and for `import-players` the
 * two clocks were stacked in sequence: the route opened a 240s budget, then called this, which
 * was entitled to spend all 240s of it. Measured in production 2026-09-10 — three consecutive
 * runs at 240,580 / 240,884 / 240,413 ms — after which `budget.exhausted()` was true the instant
 * this returned, so ALL TEN follow-on phases deferred every time:
 *
 *     identity · devyPool · devyStats · devyDraftStatus · devyIntelSources
 *     devyIntel · sleeperRows · canonicalBirthdays · espnIdentities · psychProfiles
 *
 * ⚠ IT LOOKED LIKE A PHASE-ORDERING BUG AND IS NOT. `psychProfiles` sits last and is the first
 * dropped, so it appeared to be uniquely starved; in fact the whole tail was, and reordering
 * would only have moved the starvation to whichever phase inherited last place. Two independent
 * clocks holding the same value is the defect.
 */
const IMPORT_BUDGET_MS = 240_000

/**
 * Headroom reserved so a sport never STARTS with too little time to finish.
 *
 * ⚠ THE BUDGET ALONE DOES NOT BOUND THE HANDLER. It is checked BETWEEN sports, so a sport
 * beginning at 239s runs to completion past the check — and `import-players` returned HTTP 502
 * at 300,072ms on 2026-08-23 doing exactly that. The completed runs in sync_job_runs cluster at
 * 240-254s; the 502 runs write NO row at all, because the route records telemetry only after the
 * importer returns. The failures are invisible in the very table you would check.
 *
 * With the reserve, no sport starts after IMPORT_BUDGET_MS - PER_SPORT_RESERVE_MS, so the worst
 * case is that boundary plus one bounded sport rather than that boundary plus infinity.
 */
const PER_SPORT_RESERVE_MS = 45_000

/**
 * Ceiling for the two live provider calls per sport (projections, rankings).
 *
 * These are the only genuinely external operations in the per-sport `Promise.all`; the other
 * seven are local Prisma reads. Before this, a provider that hung had no ceiling at all —
 * measured in production 2026-07-20, `rolling-insights` returned "Probe timeout after 30000ms"
 * on nfl/projections and the function was killed at 300s with a 504, having written nothing.
 */
const PROVIDER_FETCH_TIMEOUT_MS = 25_000

/**
 * Resolve `value`, or fall back to `onTimeout` if it takes longer than `ms`.
 *
 * Deliberately does NOT reject: `apiChain.fetch` already degrades through cached/DB tiers, so a
 * slow provider should look like "no rows from this provider" rather than failing the whole
 * `Promise.all` and losing the sport's other eight results.
 */
async function withTimeout<T>(value: Promise<T>, ms: number, label: string, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      value,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[sports-data-importer] ${label} exceeded ${ms}ms — continuing without it`)
          resolve(onTimeout)
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** What `loadCurrentInjuryResolver` needs from a seed. */
type InjurySeed = { name: string; team?: string | null; position?: string | null; status?: string | null; source?: string | null }

/**
 * ⚠ `team` AND `position` CARRY PLACEHOLDERS, AND THEY ARE NOT DATA. `SportsPlayerRecord.team` and
 * `.position` are NOT NULL, so a seed whose source states no team is written `'FA'` and one with no
 * position `'FLEX'` (an injury-invented seed always is). Kept because the columns require a value and
 * inventing a real one would be worse — but read them as "unknown": `'FA'` here is indistinguishable
 * from Sleeper's genuine free-agent `'FA'`, and `'FLEX'` is no football position at all. The value
 * binder (`sports-data-importer-binding.ts`) treats `'FLEX'` as no position and never accepts `'FA'`
 * as proof of identity; a reader should do the same.
 */
type PlayerSeed = {
  id: string
  name: string
  team: string
  position: string
  status?: string | null
  source: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function currentSeasonForSport(): number {
  return new Date().getFullYear()
}

// SportsPlayerRecord.id is @db.VarChar(128); fallback ids embed name+team, which for college
// inputs can push past it. Overlong ids keep a deterministic 120-char prefix + 8-char suffix
// derived from the full string so re-imports stay idempotent.
const PLAYER_ID_MAX_LENGTH = 128

function boundPlayerId(id: string): string {
  if (id.length <= PLAYER_ID_MAX_LENGTH) return id
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return `${id.slice(0, PLAYER_ID_MAX_LENGTH - 9)}:${hash.toString(36).padStart(8, '0').slice(0, 8)}`
}

function buildPlayerId(sport: string, rawId: string | null | undefined, name: string, team?: string | null): string {
  if (rawId) return boundPlayerId(`${sport}:${rawId}`)
  const slug = normalizePlayerName(name).replace(/\s+/g, '-')
  return boundPlayerId(`${sport}:${slug}:${team || 'FA'}`)
}

/** Per-sport tally of how team codes were resolved — surfaced in the import report so
 * `truncated_fallback` growth is visible instead of silent. */
export type TeamCodeCounts = Record<TeamCodeNormalization, number>

function emptyTeamCodeCounts(): TeamCodeCounts {
  return { canonical: 0, provider_code: 0, mapped: 0, derived: 0, truncated_fallback: 0, missing: 0 }
}

interface TeamCodeContext {
  sport: SupportedSport
  teamCodeMap: ReadonlyMap<string, string>
  counts: TeamCodeCounts
}

/** Resolve a raw provider team value to a ≤32-char code, tallying how it resolved. */
function resolveTeamCode(ctx: TeamCodeContext, rawTeam: string | null | undefined): string {
  const result = normalizeTeamCode({ sport: ctx.sport, rawTeam, teamCodeMap: ctx.teamCodeMap })
  ctx.counts[result.normalization] += 1
  return result.code ?? 'FA'
}

/**
 * College seed pagination. The apiChain 'players' DB tier serves a fixed default of 200 rows
 * (`readFromNormalizedTables` → `toPositiveInt(mergedQuery.limit, 200)`) — a pagination
 * default, not a safety limit — which capped NCAAF/NCAAB pool growth at ~200/sport/run while
 * their source tables hold tens of thousands. These sports get a supplementary CURSOR-PAGED
 * read of SportsPlayer with a checkpoint carried in the import-players SyncJobRun metadata:
 * each run continues where the last one stopped (no rescanning), bounded per run, and wraps
 * to the start once the source is exhausted so later source changes are re-observed.
 */
// `COLLEGE_PAGED_SPORTS` is defined in `sports-player-record-freshness.ts` so readers can share it.
export const DEFAULT_SEED_PAGE_SIZE = 2_500
export const MAX_SEED_PAGE_SIZE = 25_000

export interface PagedSeedTelemetry {
  count: number
  cursorStart: string | null
  cursorEnd: string | null
  exhausted: boolean
}

/** Latest per-sport seed cursors from the most recent import-players run record. */
async function loadSeedCheckpoints(): Promise<Record<string, string>> {
  const latest = await prisma.syncJobRun.findFirst({
    where: { jobName: 'import-players' },
    orderBy: { startedAt: 'desc' },
    select: { metadata: true },
  })
  const meta = latest?.metadata
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const cursors = (meta as Record<string, unknown>).seedCursors
    if (cursors && typeof cursors === 'object' && !Array.isArray(cursors)) {
      const out: Record<string, string> = {}
      for (const [sport, cursor] of Object.entries(cursors as Record<string, unknown>)) {
        if (typeof cursor === 'string' && cursor) out[sport] = cursor
      }
      return out
    }
  }
  return {}
}

/** One bounded page of source players → seeds, resuming from `cursor`. */
async function fetchPagedSourceSeeds(
  sport: SupportedSport,
  teamCtx: TeamCodeContext,
  cursor: string | null,
  pageSize: number
): Promise<{ seeds: PlayerSeed[]; telemetry: PagedSeedTelemetry }> {
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport },
    orderBy: { id: 'asc' },
    take: pageSize,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, externalId: true, name: true, team: true, position: true, status: true },
  })

  const seeds: PlayerSeed[] = []
  for (const row of rows) {
    const name = row.name?.trim()
    if (!name) continue
    seeds.push({
      id: buildPlayerId(sport, row.externalId || null, name, row.team),
      name,
      team: resolveTeamCode(teamCtx, row.team),
      position: normalizePositionForSport(sport, row.position) ?? 'FLEX',
      status: row.status,
      source: 'cached',
    })
  }

  const exhausted = rows.length < pageSize
  return {
    seeds,
    telemetry: {
      count: seeds.length,
      cursorStart: cursor,
      // Wrap on exhaustion so the next cycle re-observes the source from the top.
      cursorEnd: exhausted ? null : rows[rows.length - 1]?.id ?? cursor,
      exhausted,
    },
  }
}

/** Build the UPPERCASED SportsTeam.name → shortName map used as the provider-code tier. */
async function loadTeamCodeMap(sport: SupportedSport): Promise<Map<string, string>> {
  const teams = await prisma.sportsTeam.findMany({
    where: { sport },
    select: { name: true, shortName: true },
  })
  const map = new Map<string, string>()
  for (const team of teams) {
    const short = team.shortName?.trim()
    if (team.name && short) map.set(team.name.trim().toUpperCase(), short)
  }
  return map
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function asArrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : []
}

async function fetchProviderPlayerSeeds(sport: SupportedSport, season: number, teamCtx: TeamCodeContext): Promise<PlayerSeed[]> {
  const response = await apiChain.fetch({
    sport,
    dataType: 'players',
    query: { season: String(season) },
  })

  const rows = asArrayRecords(response.data)
  const seeds: PlayerSeed[] = []
  for (const row of rows) {
    const name = String(row.name ?? row.playerName ?? row.player ?? '').trim()
    if (!name) continue

    const team = resolveTeamCode(teamCtx, String(row.team ?? row.teamAbbrev ?? ''))
    const position = normalizePositionForSport(sport, String(row.position ?? row.pos ?? '')) ?? 'FLEX'
    const externalId = String(row.id ?? row.externalId ?? row.playerId ?? '').trim() || null

    seeds.push({
      id: buildPlayerId(sport, externalId, name, team),
      name,
      team,
      position,
      status: typeof row.status === 'string' ? row.status : null,
      source: response.source,
    })
  }

  return seeds
}

/**
 * Identity-map seeds are read in pages of this many rows, in `id` order.
 *
 * 🛑 THIS WAS ONE `take: 5000` WITH NO `orderBy` (2026-10-11), SO WHICH ATHLETES WERE SEEDED WAS
 * WHATEVER POSTGRES HANDED BACK FIRST. Measured that day: NFL holds 9,567 identity rows, MLB 7,320,
 * NCAAB 18,209 and NCAAF 62,751 — so 4,567 NFL and 2,320 MLB athletes were never seeded from the
 * identity map, and which ones was decided by heap order, not by anything about the player.
 */
export const IDENTITY_SEED_PAGE_SIZE = 5_000

/**
 * Ceiling on identity rows read for ONE non-college sport in one run — a guard, not a window. The
 * largest such sport is NFL at 9,567 (2026-10-11), two pages. A sport that outgrows it is read up to
 * the ceiling, in the same order every run, and says so in `identitySeeds` telemetry.
 */
export const IDENTITY_SEED_MAX_ROWS = 25_000

/** Cursor key for a college sport's identity rotation inside the run record's `seedCursors`. */
export function identitySeedCursorKey(sport: string): string {
  return `identity:${sport}`
}

/**
 * The sport's identity-map seeds, in a STABLE order (`id` ascending), paged by `id > cursor`.
 *
 *  - Every sport outside `COLLEGE_PAGED_SPORTS` is read COMPLETELY each run (up to
 *    `IDENTITY_SEED_MAX_ROWS`): NFL 9,567 rows is two reads. Reading all of them matters beyond
 *    coverage: after a successful upsert, every row of the sport the run did NOT write has its injury
 *    fields cleared, so an athlete seeded only every other run would lose a live designation every
 *    other run.
 *  - NCAAF (62,751) and NCAAB (18,209) cannot be written whole inside a run, so — exactly like their
 *    `SportsPlayer` source pages — they rotate: ONE page per run from the cursor the last run left,
 *    wrapping to the start once the end is reached. Same row volume as before, but every athlete now
 *    comes round instead of the same 5,000 forever.
 *
 * `id > cursor` rather than Prisma's `cursor:` option: a deleted cursor row still resumes correctly.
 */
async function loadIdentitySeeds(
  sport: SupportedSport,
  teamCtx: TeamCodeContext,
  cursor: string | null,
): Promise<{ seeds: PlayerSeed[]; telemetry: PagedSeedTelemetry }> {
  const rotate = COLLEGE_PAGED_SPORTS.has(sport)
  const rows: Array<{
    id: string
    canonicalName: string
    currentTeam: string | null
    position: string | null
    sleeperId: string | null
    clearSportsId: string | null
    status: string | null
  }> = []
  let after = rotate ? cursor : null
  let exhausted = false
  for (;;) {
    const page = await prisma.playerIdentityMap.findMany({
      where: { sport, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: IDENTITY_SEED_PAGE_SIZE,
      select: {
        id: true,
        canonicalName: true,
        currentTeam: true,
        position: true,
        sleeperId: true,
        clearSportsId: true,
        status: true,
      },
    })
    rows.push(...page)
    if (page.length < IDENTITY_SEED_PAGE_SIZE) {
      exhausted = true
      break
    }
    after = page[page.length - 1]!.id
    if (rotate || rows.length >= IDENTITY_SEED_MAX_ROWS) break
  }
  if (!rotate && !exhausted) {
    console.warn(
      `[sports-data-importer] ${sport} identity seeds stopped at the ${IDENTITY_SEED_MAX_ROWS}-row ceiling — later rows by id were not seeded this run`,
    )
  }

  const seeds = rows
    .map((row) => ({
      id: buildPlayerId(sport, row.sleeperId ?? row.clearSportsId ?? null, row.canonicalName, row.currentTeam),
      name: row.canonicalName,
      team: resolveTeamCode(teamCtx, row.currentTeam),
      position: normalizePositionForSport(sport, row.position) ?? 'FLEX',
      status: row.status,
      source: 'manual',
    }))
    .filter((row) => Boolean(row.name))
  return {
    seeds,
    telemetry: {
      count: seeds.length,
      cursorStart: rotate ? cursor : null,
      // Rotating sports resume here next run; a complete read, or the end of a rotation, wraps.
      cursorEnd: rotate && !exhausted ? after : null,
      exhausted,
    },
  }
}

export type SleeperIdOwner = { sleeperId: string; name: string; position?: string | null }

/**
 * Every Sleeper id for this sport, with the player Sleeper itself assigns it — from Sleeper's own
 * `SportsPlayer` record (newest row per id), which is what the Trade Center's roster resolver reads.
 *
 * ⚠ NOT `PlayerIdentityMap`. The identity map covers fewer ids (9,037 NFL vs Sleeper's 11,960) and
 * its position disagrees with Sleeper's on 3,499 of the ids both hold (measured 2026-09-28).
 */
async function loadSleeperIdOwners(sport: SupportedSport): Promise<SleeperIdOwner[]> {
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport, source: 'sleeper', sleeperId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: { sleeperId: true, name: true, position: true },
  })
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    if (!row.sleeperId || !row.name || seen.has(row.sleeperId)) return []
    seen.add(row.sleeperId)
    return [{ sleeperId: row.sleeperId, name: row.name, position: normalizePositionForSport(sport, row.position) }]
  })
}

/**
 * Rolling Insights id → Sleeper id, from the identity map — the crosswalk that lets a season-stats row
 * (keyed by RI's id) bind to the seed of the same athlete BY ID rather than by name.
 *
 * Measured 2026-10-11: all 2,774 NFL RI ids in `player_season_stats` have an identity row, 2,675 of
 * them with a Sleeper id. `@@unique([sport, rollingInsightsId])` makes each RI id one row. Every RI
 * id here is an id in RI's namespace and is only ever compared with a stat row's `playerId` whose
 * `source` is Rolling Insights — never with a seed id, which is the collision recorded below.
 */
async function loadRollingInsightsToSleeperIds(sport: SupportedSport): Promise<Map<string, string>> {
  const rows = await prisma.playerIdentityMap.findMany({
    where: { sport, rollingInsightsId: { not: null }, sleeperId: { not: null } },
    select: { rollingInsightsId: true, sleeperId: true },
  })
  const map = new Map<string, string>()
  for (const row of rows) {
    if (row.rollingInsightsId && row.sleeperId) map.set(row.rollingInsightsId, row.sleeperId)
  }
  return map
}

/**
 * 🛑 A BARE `<SPORT>:<n>` ID IS A SLEEPER ID TO EVERY READER, SO ONLY SLEEPER'S PLAYER MAY HOLD IT
 * (2026-09-28).
 *
 * `buildPlayerId` turned ANY provider's raw id into `<SPORT>:<raw>`, and a provider seed beats an
 * identity seed of the same name. So Rolling Insights' id for Trent McDuffie (6770) was written
 * as `NFL:6770` — which is Joe Burrow's Sleeper id — and Burrow himself went to `NFL:5427`, his
 * Rolling Insights id. `getPlayer` reads a Sleeper roster's bare id as `<SPORT>:<id>`
 * (lib/data/players.ts), so the Trade Center priced Burrow's slot as "Trent McDuffie, DB" and
 * withheld it, in 331 Sleeper roster slots; Zay Flowers read as "Dillon Bell" in 330. Measured on
 * production: 338 bare NFL ids held a different player from the one Sleeper assigns them.
 *
 * Two rules, applied to the merged seeds:
 *  - a player whose name belongs to exactly ONE Sleeper id is written under that id, whichever
 *    source supplied the row;
 *  - a bare id that Sleeper assigns to somebody else is never written; that player falls back to
 *    the name/team key, the same form a seed with no id already uses.
 * A name shared by two Sleeper players (two Michael Carters) is not guessed at.
 *
 * ⚠ AND A ROW ON A SLEEPER ID TAKES SLEEPER'S POSITION, NOT THE SEED'S (2026-09-28). The first cut
 * of this moved the ID and kept the seed's position, so an injury-report seed — which has no position
 * and writes `FLEX` — landed on Jaire Alexander's Sleeper id as a `FLEX`, and a provider seed brought
 * its own label (573 rows in the first run, 29 of them rostered). The id now says Sleeper's player,
 * so the position says Sleeper's position too; a seed's own label is kept only when Sleeper has none.
 */
export function keySeedsToSleeperIdentity<T extends { id: string; name: string; team: string; position: string }>(
  sport: string,
  seeds: T[],
  owners: SleeperIdOwner[],
): T[] {
  if (owners.length === 0) return seeds
  const ownerById = new Map<string, { name: string; position: string | null }>()
  const idsByName = new Map<string, Set<string>>()
  for (const owner of owners) {
    const name = normalizePlayerName(owner.name)
    if (!name) continue
    ownerById.set(owner.sleeperId, { name, position: owner.position?.trim() || null })
    const ids = idsByName.get(name) ?? new Set<string>()
    ids.add(owner.sleeperId)
    idsByName.set(name, ids)
  }
  const prefix = `${sport}:`
  const onSleeperId = (seed: T, sleeperId: string): T => {
    const position = ownerById.get(sleeperId)?.position
    return { ...seed, id: boundPlayerId(`${prefix}${sleeperId}`), ...(position ? { position } : {}) }
  }
  return seeds.map((seed) => {
    const name = normalizePlayerName(seed.name)
    const ids = idsByName.get(name)
    if (ids?.size === 1) return onSleeperId(seed, [...ids][0])
    const raw = seed.id.startsWith(prefix) ? seed.id.slice(prefix.length) : null
    const owner = raw != null ? ownerById.get(raw) : undefined
    if (owner === undefined) return seed
    if (owner.name !== name) return { ...seed, id: buildPlayerId(sport, null, seed.name, seed.team) }
    return onSleeperId(seed, raw!)
  })
}

/** Name/team/position of a provider projection or ranking row — the fields its binding is verified by. */
function describeProviderRow(row: Record<string, unknown>): { name: string; team: string | null; position: string | null } {
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
  return {
    name: String(row.name ?? row.playerName ?? row.player ?? '').trim(),
    team: text(row.team ?? row.teamAbbrev ?? row.team_abbr),
    position: text(row.position ?? row.pos),
  }
}

/** A provider row's Sleeper id, when it states one — the only id namespace a seed id is known to share. */
function providerRowSeedId(sport: string, row: Record<string, unknown>): string | null {
  const sid = String(row.sleeperId ?? row.sleeper_id ?? '').trim()
  return sid ? boundPlayerId(`${sport}:${sid}`) : null
}

/**
 * Each ranking row with its 1–100 dynasty value: the row's own value when it states one, else its
 * POSITION in the list squeezed to 1–100. Computed per ROW, before binding, so the value a seed gets
 * is the one its own row earned.
 */
function buildDynastyValueRows(rows: Array<Record<string, unknown>>): Array<{ row: Record<string, unknown>; value: number }> {
  return rows.map((row, index) => {
    const explicit = Number(row.dynasty_value ?? row.dynastyValue ?? row.score ?? row.value)
    const derived = Number.isFinite(explicit) ? explicit : clamp(100 - index, 1, 100)
    return { row, value: Math.round(clamp(derived, 1, 100)) }
  })
}

/*
 * ── KEEPING `injuryStatus` HONEST ON ROWS THIS RUN DID NOT WRITE ─────────────────────────────────
 *
 * The write path (`loadCurrentInjuryResolver`) only cleans the rows it rewrites. Measured in
 * production 2026-10-11, rows not rewritten since that fix deployed still held 80,923 NCAAF, 22,509
 * NCAAB and 19,409 NFL roster codes (INACT/ACT/Active…) plus 811 NFL designations nobody was
 * reporting any more (391 "Questionable" last written 2026-09-28). They go untouched two ways:
 * orphan rows whose id is no longer on any seed, and a sport whose upsert throws, whose catch path
 * only relabelled `dataSource`. Three cleanups close it, below.
 *
 * 🛑 RAW SQL, NOT `updateMany`, BECAUSE `updateMany` BUMPS `lastUpdated` (`@updatedAt`). Readers pick
 * the newest row per player by `lastUpdated` (lib/data/players.ts, FantasyValueSnapshotService,
 * trade-pre-analysis…), so clearing an orphan row through Prisma would make that stale orphan the
 * NEWEST row for its name and let it beat the current one. Raw SQL leaves `last_updated` alone, and
 * the `IS NOT NULL` filters make every statement touch only rows that actually need clearing.
 *
 * ⚠ `last_updated` is TIMESTAMP(3) WITHOUT TIME ZONE holding UTC (Prisma writes it), so the cutoff is
 * passed as a zone-less UTC string cast to timestamp(3). Passing a `Date` would compare against a
 * timestamptz and shift by the session's TimeZone — in the direction that could reach rows this run
 * just wrote.
 */

/**
 * Margin subtracted from a sport's write-start before it is used as the "not written this run"
 * cutoff. `@updatedAt` is stamped by the in-process query engine from the same clock as `Date.now()`,
 * so written rows are already >= the write-start; the margin is insurance against a clock step, in
 * the only safe direction (a row touched by another writer inside it merely escapes until next run).
 */
const UNWRITTEN_CUTOFF_MARGIN_MS = 60_000

function toPgUtcTimestamp(date: Date): string {
  // 2026-10-11T17:55:00.123Z -> 2026-10-11 17:55:00.123
  return date.toISOString().replace('T', ' ').replace('Z', '')
}

/**
 * Null `injuryStatus`/`injuryNotes` on every `sport` row last written before `cutoff`.
 * Returns the number of rows changed. Never touches `last_updated` (see the note above).
 */
async function clearInjuryWrittenBefore(sport: string, cutoff: Date): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "sports_players"
       SET "injury_status" = NULL, "injury_notes" = NULL
     WHERE "sport" = ${sport}
       AND "last_updated" < ${toPgUtcTimestamp(cutoff)}::timestamp(3)
       AND ("injury_status" IS NOT NULL OR "injury_notes" IS NOT NULL)
  `
}

/**
 * The sport-independent column guard: clear every `injuryStatus` that is not a designation per
 * `isStoredInjuryDesignation`, and every `injuryNotes` left with no status beside it.
 *
 * The DISTINCT values are read and classified in JS, then cleared by exact value — so the database
 * guard and the write path apply literally the same predicate rather than a SQL re-implementation of
 * it. A distinct-value read over `sports_players` is one grouped scan; the column holds a few hundred
 * distinct values, not one per row.
 */
export async function clearNonDesignationInjuryStatuses(): Promise<{ cleared: number; values: string[] }> {
  const groups = await prisma.sportsPlayerRecord.groupBy({
    by: ['injuryStatus'],
    where: { injuryStatus: { not: null } },
  })
  const values = groups
    .map((group) => group.injuryStatus)
    .filter((value): value is string => typeof value === 'string' && !isStoredInjuryDesignation(value))
  const cleared = await prisma.$executeRaw`
    UPDATE "sports_players"
       SET "injury_status" = NULL, "injury_notes" = NULL
     WHERE "injury_status" = ANY(${values}::text[])
        OR ("injury_status" IS NULL AND "injury_notes" IS NOT NULL)
  `
  return { cleared, values }
}

export type StoredInjuryCleanup = {
  /** Per sport: rows the run did not write whose injury fields were cleared after a successful upsert. */
  unwrittenCleared: Record<string, number>
  /** Per sport: rows older than the TTL cleared because that sport's upsert failed. */
  staleClearedAfterFailure: Record<string, number>
  /** Rows cleared by the sport-independent non-designation guard, and the values it removed. */
  nonDesignationCleared: number
  nonDesignationValues: string[]
  errors: string[]
}

export async function runSportsDataImporter(options?: {
  sports?: string[]
  /** College source-page size per sport per run; clamped to MAX_SEED_PAGE_SIZE. */
  seedPageSize?: number
  /**
   * Wall-clock ms this import may use, carved out of the CALLER's budget.
   *
   * Pass this from any handler that has work of its own after the import — see the note on
   * `IMPORT_BUDGET_MS`. Omitting it keeps the historical behaviour of assuming the whole
   * window, which is correct only for a caller that does nothing afterwards.
   *
   * ⚠ FLOORED AT `PER_SPORT_RESERVE_MS`, so a caller that arrives with almost no time left
   * still gets a coherent budget rather than a negative one. A negative budget would make the
   * between-sports check true immediately and skip EVERY sport while reporting success — the
   * silent no-op this reserve exists to prevent.
   */
  budgetMs?: number
}): Promise<{
  imported: number
  sports: string[]
  staleFallbackApplied: boolean
  skippedSports: string[]
  durationMs: number
  teamCodeCounts: Record<string, TeamCodeCounts>
  rowsSkippedByGuard: number
  pagedSeeds: Record<string, PagedSeedTelemetry>
  /** Per sport: identity-map rows read this run, and the college rotation cursor. */
  identitySeeds: Record<string, PagedSeedTelemetry>
  seedCursors: Record<string, string>
  injuryCleanup: StoredInjuryCleanup
}> {
  const targetSports = (options?.sports?.length ? options.sports : SUPPORTED_SPORTS).map((sport) =>
    normalizeToSupportedSport(sport)
  )
  const uniqueSports = Array.from(new Set(targetSports))
  let imported = 0
  let staleFallbackApplied = false

  const startedAt = Date.now()
  /*
   * The caller's slice when given, this module's default otherwise — resolved ONCE so the
   * between-sports check and the log line it prints can never disagree about which budget was
   * in force. Reading two separately-derived numbers is how a log comes to describe a run that
   * did not happen.
   */
  const effectiveBudgetMs = Math.max(PER_SPORT_RESERVE_MS, options?.budgetMs ?? IMPORT_BUDGET_MS)
  const usableBudgetMs = effectiveBudgetMs - PER_SPORT_RESERVE_MS
  const skippedSports: string[] = []
  const teamCodeCounts: Record<string, TeamCodeCounts> = {}
  let rowsSkippedByGuard = 0

  const seedPageSize = Math.min(
    Math.max(1, Math.floor(options?.seedPageSize ?? DEFAULT_SEED_PAGE_SIZE)),
    MAX_SEED_PAGE_SIZE
  )
  const seedCheckpoints = uniqueSports.some((sport) => COLLEGE_PAGED_SPORTS.has(sport))
    ? await loadSeedCheckpoints()
    : {}
  const pagedSeeds: Record<string, PagedSeedTelemetry> = {}
  const identitySeedTelemetry: Record<string, PagedSeedTelemetry> = {}
  const seedCursors: Record<string, string> = { ...seedCheckpoints }
  const injuryCleanup: StoredInjuryCleanup = {
    unwrittenCleared: {},
    staleClearedAfterFailure: {},
    nonDesignationCleared: 0,
    nonDesignationValues: [],
    errors: [],
  }
  const recordCleanupError = (step: string, error: unknown) => {
    const message = `${step}: ${error instanceof Error ? error.message : String(error)}`
    injuryCleanup.errors.push(message)
    console.error('[sports-data-importer] injury cleanup failed', { step, error: message })
  }

  for (const sport of uniqueSports) {
    /**
     * Per-sport budget. The loop is sequential and NFL is first in SUPPORTED_SPORTS, so before
     * this a sport whose providers hung consumed the entire function and every sport behind it
     * never ran at all. That is not hypothetical: NBA, NHL, MLB and SOCCER sat at 2026-04-26 in
     * production — frozen the day these crons stopped being deployed — while NFL kept getting
     * partial updates from other paths. Stopping early leaves those sports untouched rather
     * than starved, and the next scheduled run reaches them.
     */
    if (Date.now() - startedAt > usableBudgetMs) {
      skippedSports.push(sport)
      console.warn(
        `[sports-data-importer] budget exhausted (${usableBudgetMs}ms usable of ${effectiveBudgetMs}ms) — skipping ${sport}`,
      )
      continue
    }

    const season = currentSeasonForSport()

    // Name → shortName map first: it's the tier that keeps full college institution names out
    // of the VarChar(32) team column (SportsTeam.shortName covers 100% of NCAAF/NCAAB in prod).
    const teamCtx: TeamCodeContext = {
      sport,
      teamCodeMap: await loadTeamCodeMap(sport),
      counts: emptyTeamCodeCounts(),
    }
    teamCodeCounts[sport] = teamCtx.counts

    const [identityPage, sleeperIdOwners, riToSleeperId, providerSeeds, latestStats, latestInjuries, latestNews, latestAdp, metaTrends, projectionsResponse, rankingsResponse] =
      await Promise.all([
        loadIdentitySeeds(sport, teamCtx, seedCheckpoints[identitySeedCursorKey(sport)] ?? null),
        loadSleeperIdOwners(sport),
        loadRollingInsightsToSleeperIds(sport),
        // The only UNBOUNDED provider read in this block. `projections` and `rankings` below were
        // already wrapped; this one was not, and it is the same apiChain.fetch against the same
        // providers. An unbounded call here is what turns a 239s start into a 300s edge 502.
        //
        // Empty-array fallback matches withTimeout's contract of degrading rather than throwing: a
        // sport with no provider seeds still imports from its identity and paged sources.
        withTimeout(
          fetchProviderPlayerSeeds(sport, season, teamCtx),
          PROVIDER_FETCH_TIMEOUT_MS,
          `${sport} player seeds`,
          [] as PlayerSeed[],
        ),
        /*
         * NEWEST SEASON FIRST, NOT NEWEST FETCH — and every row a player has, so the newest season per
         * PLAYER is chosen after binding (`pickLatestSeasonRow`). This read used to be `fetchedAt desc,
         * take 4000` with no season at all: Rolling Insights re-pulls back seasons, so the 4,000 most
         * recently FETCHED rows were a mix of seasons. Replayed on production 2026-10-11: of the 2,533
         * NFL names that cut reached, 492 were written a season other than their newest on file, and
         * 241 of the 2,774 names were not reached at all.
         *
         * `season` is a string — "2025", or "2024-2025" outside football — and both forms order
         * correctly as strings. The cap is a guard, not a window: production holds 11,869 NFL rows
         * (~4 MB of stats JSON), the largest sport.
         */
        prisma.playerSeasonStats.findMany({
          where: { sport },
          orderBy: [{ season: 'desc' }, { fetchedAt: 'desc' }],
          take: 15_000,
          select: {
            playerId: true,
            playerName: true,
            position: true,
            team: true,
            season: true,
            source: true,
            fetchedAt: true,
            stats: true,
          },
        }),
        /*
         * 🛑 BOUNDED TO THE CURRENT SEASON, AND THIS READ IS WHY THE BOUND EXISTS.
         *
         * `injury_reports` has no scheduled writer outside NFL (see
         * lib/injuries/injuryRecency.ts for the production measurement — NBA, NHL,
         * MLB and NCAAB were all last written 2026-04-26, 135 days before this was
         * added). Unbounded, this read did two damaging things per non-NFL sport:
         *
         *   - `injuryStatus`/`injuryNotes` were written from these rows onto
         *     SportsPlayerRecord, a column carrying NO DATE (no longer — they now come
         *     from live SportsInjury rows, see loadCurrentInjuryResolver). A four-month-old
         *     designation became indistinguishable from one taken this morning, and
         *     FantasyValueSnapshotService reads that column FIRST.
         *   - the seed loop further down INVENTS a player from any injury row it
         *     cannot otherwise match, so last season's report also kept resurrecting
         *     roster entries.
         *
         * Dropping the stale rows leaves `injuryStatus` null, which is the honest
         * answer: SportsInjury is refreshed every 30 minutes for every sport that has
         * a source, and the port reads it. An absent status degrades to "unknown"; a
         * wrong one is asserted with full confidence.
         */
        prisma.injuryReportRecord.findMany({
          where: { sport, ...currentSeasonReportWhere() },
          orderBy: { reportDate: 'desc' },
          take: 2500,
        }),
        prisma.playerNewsRecord.findMany({
          where: { sport },
          orderBy: { publishedAt: 'desc' },
          take: 2500,
        }),
        prisma.adpDataRecord.findMany({
          where: { sport },
          orderBy: [{ season: 'desc' }, { week: 'desc' }, { createdAt: 'desc' }],
          take: 4000,
        }),
        prisma.playerMetaTrend.findMany({
          where: { sport },
          take: 4000,
        }),
        withTimeout(
          apiChain.fetch({ sport, dataType: 'projections', query: { season: String(season) } }),
          PROVIDER_FETCH_TIMEOUT_MS,
          `${sport} projections`,
          // `apiChain.fetch` returns `ApiResult`, not `ChainFetchResult`: it has no `fromCache`,
          // and `source`/`latency` are required. Mirror the module's own empty-result shape
          // (see the `chain.error && !chain.data` branch in api-chain.ts). Functionally inert —
          // with `data: null` the projection map is empty, so `.source` is never read downstream.
          { data: null, source: 'cache', latency: 0, cached: false, error: 'provider timeout' },
        ),
        withTimeout(
          apiChain.fetch({ sport, dataType: 'rankings', query: { season: String(season) } }),
          PROVIDER_FETCH_TIMEOUT_MS,
          `${sport} rankings`,
          { data: null, source: 'cache', latency: 0, cached: false, error: 'provider timeout' },
        ),
      ])

    const projectionRows = asArrayRecords(projectionsResponse.data)
    const rankingRows = asArrayRecords(rankingsResponse.data)

    const identitySeeds = identityPage.seeds
    identitySeedTelemetry[sport] = identityPage.telemetry
    if (identityPage.telemetry.cursorEnd) seedCursors[identitySeedCursorKey(sport)] = identityPage.telemetry.cursorEnd
    else delete seedCursors[identitySeedCursorKey(sport)]

    // Supplementary paged source read for college sports (see COLLEGE_PAGED_SPORTS note).
    let pagedSportSeeds: PlayerSeed[] = []
    if (COLLEGE_PAGED_SPORTS.has(sport)) {
      const page = await fetchPagedSourceSeeds(sport, teamCtx, seedCheckpoints[sport] ?? null, seedPageSize)
      pagedSportSeeds = page.seeds
      pagedSeeds[sport] = page.telemetry
      if (page.telemetry.cursorEnd) seedCursors[sport] = page.telemetry.cursorEnd
      else delete seedCursors[sport]
    }

    const currentInjuryOf = await loadCurrentInjuryResolver(sport)

    /*
     * 🛑 ONE SEED PER ATHLETE, NOT PER NAME (2026-10-11). This was `Map<normalizePlayerName(name), seed>`,
     * so of two namesakes one survived each run and the other's row stopped refreshing. Seeds that
     * carry one Sleeper identity (every unique name) fold exactly as before; a name Sleeper gives to
     * two or more players keeps one seed per Sleeper id — see `collapseSeedsByIdentity`.
     */
    const fallbackSeeds: PlayerSeed[] = [
      ...latestAdp.map((row) => ({
        id: buildPlayerId(sport, row.playerId, row.playerName, row.team),
        name: row.playerName,
        team: resolveTeamCode(teamCtx, row.team),
        position: normalizePositionForSport(sport, row.position) ?? 'FLEX',
        source: row.source,
      })),
      ...latestInjuries.map((row) => ({
        id: buildPlayerId(sport, row.playerId, row.playerName, row.team),
        name: row.playerName,
        team: resolveTeamCode(teamCtx, row.team),
        position: 'FLEX',
        status: row.status,
        source: 'cached',
      })),
    ]
    const collapsedSeeds = collapseSeedsByIdentity(
      sport,
      [...identitySeeds, ...providerSeeds, ...pagedSportSeeds],
      fallbackSeeds,
      sleeperIdOwners,
    )

    // Two seeds can still land on one id (two name/team fallbacks); write each id once, first wins.
    const seenSeedIds = new Set<string>()
    const seeds = keySeedsToSleeperIdentity(sport, collapsedSeeds, sleeperIdOwners).filter((seed) => {
      if (seenSeedIds.has(seed.id)) return false
      seenSeedIds.add(seed.id)
      return true
    })

    /*
     * 🛑 EVERY VALUE BINDS TO A SEED BY ID, ELSE BY A VERIFIED NAME — NEVER BY NAME ALONE (2026-10-11).
     * These were five `Map<name, row>`s, first row wins, so the surviving namesake took whichever row
     * came first: LB Justin Jefferson carried the WR's ADP 21.3, guard Josh Allen carried 12.6, DB DJ
     * Moore the WR's 47.5. See `createSeedValueBinder`; an ambiguous name binds to nobody.
     */
    const namesakes = countNamesakes(seeds)
    // A value row's team, translated by the SAME normalizer the seeds went through (without tallying
    // it in `teamCodeCounts`). Kept when it came from a table the seeds also use — the NFL canonical
    // table, or this sport's SportsTeam name → code map — or lands on a code some seed carries.
    // Anything else is a vocabulary we cannot compare ("Arizona Diamondbacks" with no SportsTeam row
    // vs a seed's "ARI"), so it says nothing rather than contradicting.
    const seedTeamCodes = new Set(seeds.map((seed) => seed.team.toUpperCase()))
    const teamOf = (raw: string | null | undefined): string | null => {
      const team = normalizeTeamCode({ sport, rawTeam: raw, teamCodeMap: teamCtx.teamCodeMap })
      const code = team.code?.toUpperCase() ?? null
      if (!code) return null
      return team.normalization === 'canonical' || team.normalization === 'mapped' || seedTeamCodes.has(code) ? code : null
    }
    // Only the NFL's team codes are one vocabulary on both sides; elsewhere a team verifies but never
    // refutes (see `teamContradicts` in the binder).
    const teamContradicts = sport === 'NFL'
    const statsOf = createSeedValueBinder(
      sport,
      latestStats,
      (row) => ({ name: row.playerName, team: row.team, position: row.position }),
      {
        namesakes,
        teamOf,
        teamContradicts,
        seedIds: seenSeedIds,
        // Only Rolling Insights' ids are crosswalked; they are compared with RI stat rows only.
        idOf: (row) => {
          if (row.source !== 'rolling_insights') return null
          const sleeperId = riToSleeperId.get(row.playerId)
          return sleeperId ? boundPlayerId(`${sport}:${sleeperId}`) : null
        },
      },
    )
    const adpOf = createSeedValueBinder(
      sport,
      latestAdp,
      (row) => ({ name: row.playerName, team: row.team, position: row.position }),
      { namesakes, teamOf, teamContradicts },
    )
    const newsOf = createSeedValueBinder(
      sport,
      latestNews,
      (row) => ({ name: row.playerName, team: row.team, position: null }),
      { namesakes, teamOf, teamContradicts },
    )
    const projectionsOf = createSeedValueBinder(sport, projectionRows, describeProviderRow, {
      namesakes,
      teamOf,
      teamContradicts,
      seedIds: seenSeedIds,
      idOf: (row) => providerRowSeedId(sport, row),
    })
    const dynastyOf = createSeedValueBinder(sport, buildDynastyValueRows(rankingRows), (ranked) => describeProviderRow(ranked.row), {
      namesakes,
      teamOf,
      teamContradicts,
      seedIds: seenSeedIds,
      idOf: (ranked) => providerRowSeedId(sport, ranked.row),
    })
    const trendMap = new Map<string, number>(
      metaTrends.map((row) => [String(row.playerId), Number(row.trendScore ?? 0)])
    )

    const rows = seeds.flatMap((seed) => {
      const injury = currentInjuryOf(seed)
      const adp = adpOf(seed)[0]
      const trendScore = trendMap.get(adp?.playerId ?? '')
      const projectionRow = projectionsOf(seed)[0]
      const projections = projectionRow ?? {}
      const dynastyValue = dynastyOf(seed)[0]?.value
      const stats = pickLatestSeasonRow(statsOf(seed))?.stats
      // The matcher appends a name's teamless rows after its team rows, so re-sort before taking three.
      const news = [...newsOf(seed)].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, 3).map((item) => ({
        headline: item.headline,
        impact: item.impact,
        source: item.source,
        publishedAt: item.publishedAt.toISOString(),
      }))

      // Schema-boundary guard: every VarChar-bounded field is enforced here so ONE bad row is
      // skipped and reported instead of throwing inside the batch transaction and aborting the
      // entire sport's import — which is exactly how NCAAF/NCAAB stayed at 5,226/100 rows while
      // their source tables held 44,897/18,209.
      try {
        return [{
          id: seed.id,
          sport,
          name: seed.name.slice(0, 128),
          team: assertTeamCodeFits(seed.team) ?? 'FA',
          position: (seed.position || 'FLEX').slice(0, 32),
          stats: asRecord(stats) ?? {},
          projections,
          adp: adp?.adp ?? null,
          dynastyValue:
            dynastyValue ??
            (typeof trendScore === 'number' ? Math.round(clamp(50 + trendScore, 0, 100)) : null),
          injuryStatus: injury.status?.slice(0, 32) ?? null,
          injuryNotes: injury.notes,
          news,
          dataSource: (projectionRow ? projectionsResponse.source : seed.source).slice(0, 32),
        }]
      } catch (guardError) {
        rowsSkippedByGuard += 1
        console.error('[sports-data-importer] row skipped by schema guard', {
          sport,
          player: seed.name,
          error: guardError instanceof Error ? guardError.message : String(guardError),
        })
        return []
      }
    })

    /*
     * Captured ONCE, before the first upsert of this sport: every row this run writes is stamped
     * (by `@updatedAt`) at or after this instant, so "last_updated < writeStartedAt - margin" can
     * only ever select rows this run did NOT write — whatever the batch count, and without shipping
     * tens of thousands of written ids back to the database as a NOT IN.
     */
    const writeStartedAt = new Date()
    let upsertSucceeded = false
    try {
      for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
        await prisma.$transaction(
          batch.map((row) =>
            prisma.sportsPlayerRecord.upsert({
              where: { id: row.id },
              update: {
                sport: row.sport,
                name: row.name,
                team: row.team,
                position: row.position,
                stats: toPrismaJsonInput(row.stats),
                projections: toPrismaJsonInput(row.projections),
                adp: row.adp,
                dynastyValue: row.dynastyValue,
                injuryStatus: row.injuryStatus,
                injuryNotes: row.injuryNotes,
                news: toPrismaJsonInput(row.news),
                dataSource: row.dataSource,
              },
              create: {
                ...row,
                stats: toPrismaJsonInput(row.stats),
                projections: toPrismaJsonInput(row.projections),
                news: toPrismaJsonInput(row.news),
              },
            })
          )
        )
      }
      imported += rows.length
      upsertSucceeded = true
    } catch (error) {
      staleFallbackApplied = true
      /*
       * 🛑 THE FAILURE PATH USED TO LEAVE EVERY DESIGNATION STANDING. A sport whose batch throws
       * refreshes nothing, and the old catch only relabelled `dataSource` — so a "Questionable"
       * written weeks ago kept being served as current (391 NFL rows last written 2026-09-28).
       *
       * Cleared here: injury fields on rows older than the TTL, i.e. rows that have now missed a
       * refresh. Rows written by the previous successful run (younger than the TTL) keep theirs —
       * they carry the same few-hours lag every row has between runs, and clearing them would let one
       * transient failure wipe a whole sport's designations. Rows written earlier in THIS run are
       * younger than `writeStartedAt`, hence than the TTL, so they cannot match.
       *
       * ⚠ RUNS BEFORE the `dataSource` relabel below, whose `updateMany` bumps `lastUpdated` on the
       * same rows and would otherwise hide them from this predicate. Roster codes on the remaining
       * rows are cleared by the run-wide guard at the end of the import.
       */
      try {
        injuryCleanup.staleClearedAfterFailure[sport] = await clearInjuryWrittenBefore(
          sport,
          new Date(Date.now() - SPORTS_PLAYER_TTL_MS),
        )
      } catch (cleanupError) {
        recordCleanupError(`${sport} stale-after-failure`, cleanupError)
      }
      await prisma.sportsPlayerRecord.updateMany({
        where: {
          sport,
          lastUpdated: {
            lt: new Date(Date.now() - SPORTS_PLAYER_TTL_MS),
          },
        },
        data: {
          dataSource: 'cached',
        },
      })
      console.error('[sports-data-importer] Failed to import player data', {
        sport,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    /*
     * After a SUCCESSFUL upsert: every row of this sport the run did not write is on no seed this
     * run produced, so whatever injury it carries was not refreshed — clear it. That covers orphan
     * ids (e.g. NFL `cached` INACT rows last touched 2026-09-07) and seeds dropped by the schema
     * guard.
     *
     * ⚠ FOR THE PAGED COLLEGE SPORTS THIS INCLUDES ROWS ON LATER PAGES. NCAAF/NCAAB write one page of
     * the source per run, so a college designation lasts until the next run and then waits for its
     * page to come round. That is the rule working: a designation nobody refreshed is worse than none.
     *
     * Skipped when the sport wrote no rows at all: with nothing written there is no "this run" to
     * compare against, and clearing the whole sport on an empty seed set is a degraded read, not a
     * finding. The run-wide guard below still applies.
     */
    if (upsertSucceeded && rows.length > 0) {
      try {
        injuryCleanup.unwrittenCleared[sport] = await clearInjuryWrittenBefore(
          sport,
          new Date(writeStartedAt.getTime() - UNWRITTEN_CUTOFF_MARGIN_MS),
        )
      } catch (cleanupError) {
        recordCleanupError(`${sport} unwritten`, cleanupError)
      }
    }
  }

  /*
   * Once per run, over ALL sports — including ones skipped for budget or whose upsert failed: no
   * roster code or free text may sit in the column, whoever wrote it and whenever.
   */
  try {
    const guard = await clearNonDesignationInjuryStatuses()
    injuryCleanup.nonDesignationCleared = guard.cleared
    injuryCleanup.nonDesignationValues = guard.values
  } catch (cleanupError) {
    recordCleanupError('non-designation guard', cleanupError)
  }

  return {
    imported,
    sports: uniqueSports,
    staleFallbackApplied,
    skippedSports,
    durationMs: Date.now() - startedAt,
    teamCodeCounts,
    rowsSkippedByGuard,
    pagedSeeds,
    identitySeeds: identitySeedTelemetry,
    seedCursors,
    injuryCleanup,
  }
}

export { rosterDesignation }


/**
 * `SportsPlayerRecord.injuryStatus` for one seed: the athlete's newest claim on a live injury feed,
 * else his roster designation (IR / PUP / NFI / Suspended), else null.
 *
 * 🛑 THIS COLUMN USED TO COME FROM `injury_reports` AND THE SEED'S ROSTER STATUS (2026-10-11), AND
 * IT WAS WRONG FOR THOUSANDS OF PLAYERS. Measured that day against live `SportsInjury`:
 *   - `injury_reports` is written for NFL only by the news pass, which can say Out/Questionable but
 *     never "cleared" — 295 players still carried a "Questionable" no feed reported any more, and 84
 *     read Questionable while ESPN had them Active (DeForest Buckner, Justice Hill…);
 *   - the seed fallback wrote Rolling Insights' roster codes as designations — 10,283 "INACT" rows,
 *     including Malik Nabers while ESPN had him Active — plus Sleeper's "Inactive" for free agents;
 *   - name-keyed, first row wins, so namesakes swapped statuses.
 * League rosters, the draft room, value snapshots, trending and Chimmy all read this column. The
 * live feeds are refreshed every 30 minutes and this importer every 6 hours, so it can lag a live
 * change by a few hours — but it can no longer assert a designation nobody is reporting.
 */
export async function loadCurrentInjuryResolver(
  sport: string,
): Promise<(seed: InjurySeed) => { status: string | null; notes: string | null }> {
  let rows: Array<{ playerName: string; team: string | null; position: string | null; status: string | null; description: string | null; date: Date | null; fetchedAt: Date }> = []
  try {
    rows = await prisma.sportsInjury.findMany({
      where: { sport, expiresAt: { gt: new Date() } },
      select: { playerName: true, team: true, position: true, status: true, description: true, date: true, fetchedAt: true },
      orderBy: { fetchedAt: 'desc' },
      take: 5000,
    })
  } catch {
    rows = []
  }
  const match = createInjuryRowMatcher(rows, sport)
  const resolve = (seed: InjurySeed): { status: string | null; notes: string | null } => {
    const hit = match({ name: seed.name, team: seed.team ?? null, position: seed.position ?? null })
    const newest = hit && 'rows' in hit ? hit.rows[0] ?? null : null
    if (newest) {
      return isInjuryDesignation(newest.status)
        ? { status: newest.status, notes: newest.description?.trim() || null }
        : { status: null, notes: null }
    }
    // A seed invented from an injury report has no roster behind it, so it has no roster status either.
    return { status: seed.source === 'cached' ? null : rosterDesignation(seed.status), notes: null }
  }
  /*
   * Everything this resolver returns is what the importer WRITES, so it passes the same predicate the
   * column guard applies. `isInjuryDesignation` above only rejects active/healthy/na; a live feed that
   * publishes anything else verbatim (ESPN keeps unrecognised values) would otherwise land in the
   * column and be cleared again by the guard six hours later.
   */
  return (seed) => {
    const out = resolve(seed)
    const stored = storedInjuryFields(out.status, out.notes)
    return { status: stored.injuryStatus, notes: stored.injuryNotes }
  }
}
