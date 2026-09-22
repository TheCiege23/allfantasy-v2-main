/**
 * Widen the NCAAF identity registry from `SportsPlayer`.
 *
 * 🛑 THE REGISTRY IS THE NARROW PART, AND THE DATA IS ALREADY IN POSTGRES.
 * Measured on production 2026-08-31: `SportsPlayer` holds 73,883 NCAAF rows and
 * `PlayerIdentityMap` holds 20,027, so tens of thousands of college players our
 * own database already knows about cannot be reached by anything that resolves
 * through the registry. That is why an imported Fantrax roster connects 11 of 39
 * spots and why college projections join to nothing: not a matching bug, a
 * coverage gap, and one that needs no provider call to close.
 *
 * ⚠ KEYED ON (name, team) AND NEVER ON NAME ALONE. This is the whole design.
 * Of 7,248 colliding candidate names, 4,925 — 67.9% — are DIFFERENT PEOPLE at
 * different schools; `Ryan Davis` is 8 rows across 7 schools. A name-keyed
 * insert fuses them into one identity, which is exactly the mis-link this
 * registry exists to prevent, and it never surfaces as an error. It surfaces
 * months later as another player's projection on somebody's roster.
 *
 * 🛑 THE NAME IS NORMALIZED IN JS, ONCE, BY `normalizePlayerName` — THERE IS NO
 * SQL COPY OF THAT RULE, AND THAT IS DELIBERATE.
 *
 * The first version of this module normalized in SQL to let Postgres do the
 * grouping. A guard comparing the two implementations on 500 real rows found
 * **36 disagreements (7.2%)**, in two families:
 *
 *   Danny Lockhart Jr.  sql "danny lockhart jr"  js "danny lockhart"
 *   Patrick O'Brien     sql "patrick obrien"     js "patrick o'brien"
 *
 * `normalizePlayerName` strips generational suffixes and KEEPS apostrophes and
 * hyphens. Every one of those 36 would have been written with a key the resolver
 * never computes — rows that exist, count as success, and are unreachable by the
 * lookup they were inserted to serve. Two implementations of one rule is the
 * bug; deleting one of them is the fix, not a better SQL regex.
 *
 * `lib/team-abbrev.ts` warns above that function that its stored keys are only
 * rewritten on create, so a change to it needs `scripts/backfill-normalized-name.ts`.
 * Importing it here means this module inherits that guarantee instead of forking it.
 *
 * ⚠ INSERT-ONLY. It never updates or deletes an existing identity row. A row
 * already in the registry is canonical by definition — it may carry provider ids
 * this source knows nothing about (`sleeperId`, `cfbdId`, `fantraxId`), and
 * overwriting any of that from a cache table would be a downgrade dressed as a
 * refresh.
 *
 * ⚠ INGESTION, NOT A REQUEST PATH. Never call this from a route handler.
 */
import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'

export type NcaafIdentityWidenResult = {
  /** Distinct (normalized name, team) pairs with no registry row for that name. */
  candidates: number
  inserted: number
  /** Refused as not a person — see `looksLikeAPerson`. */
  refused: number
  /** Present by the time we reached it, so a re-run inserts nothing. */
  skipped: number
  /**
   * Not inserted because its provider id already belongs to another identity row — the same
   * person under a different spelling. Inserting would make one player two identities.
   */
  duplicateOfExisting: number
  failed: number
  dryRun: boolean
  error?: string
}

/**
 * SportsPlayer `source` → the PlayerIdentityMap column holding that provider's own id.
 * Only providers the registry has a column for; TheSportsDB has none, so its rows stay name-keyed.
 * Both write their ids unprefixed (measured 2026-09-22), the same form the registry stores.
 */
const PROVIDER_ID_COLUMN = {
  rolling_insights: 'rollingInsightsId',
  cfbd: 'cfbdId',
} as const

type ProviderIdColumn = (typeof PROVIDER_ID_COLUMN)[keyof typeof PROVIDER_ID_COLUMN]
export type NcaafProviderIds = Partial<Record<ProviderIdColumn, string>>

export type NcaafWideningPlanRow = {
  canonicalName: string
  normalizedName: string
  team: string
  position: string | null
  providerIds: NcaafProviderIds
}

/**
 * The provider ids behind one (name, team) key: an id only when EXACTLY ONE distinct id of that
 * provider sits under the key. Two distinct Rolling Insights ids under "Ryan Davis / X" are two
 * people the key cannot separate, and picking one would attach a stranger's stats — so neither
 * is written, and the row stays name-keyed exactly as before.
 */
function uniqueProviderIds(seen: Map<ProviderIdColumn, Set<string>>): NcaafProviderIds {
  const out: NcaafProviderIds = {}
  for (const [column, ids] of seen) if (ids.size === 1) out[column] = [...ids][0]
  return out
}

/**
 * Is this candidate a plausible person?
 *
 * ⚠ THE POOL IS ALMOST ENTIRELY CLEAN — 2 junk shapes in ~39,000 — so this is
 * cheap insurance rather than a filter doing heavy lifting. It is here because
 * the two it catches (`Hasan Defense`, `Ja'Kobe6 Cameron`) are exactly the kind
 * of row that becomes a permanent wrong identity, and because the pool is built
 * from a cache table that nothing stops from changing shape.
 */
export function looksLikeAPerson(name: string, normalized: string): boolean {
  if (!normalized || normalized.length < 5) return false
  /* A single token is not a college roster name in this source. */
  if (!normalized.includes(' ')) return false
  if (/[0-9]/.test(name)) return false
  if (/\b(team|defense|special teams|d\/st)\b/i.test(name)) return false
  return true
}

/**
 * Group raw `SportsPlayer` rows into the rows that would be inserted. Pure, so
 * the keying rule is testable without a database.
 *
 * ⚠ `existingNames` IS CHECKED ON THE NAME, NOT ON THE PAIR, ON PURPOSE. A name
 * the registry already holds is one we have already made a decision about;
 * inserting the other seven Ryan Davises beside an existing one would
 * manufacture ambiguity where a single confident row stands today. Widening
 * means adding people we hold NO row for, never re-litigating people we do.
 */
/*
 * 🛑 THE FIRST VERSION SELECTED ONLY name, team, position — AND WROTE 38,904 ROWS WITH NO
 * PROVIDER ID AT ALL (production, 2026-08-31 20:50–21:30 UTC). Every one was reachable by name
 * but joined to nothing by id: the RI stat importer, projections and the provider-mapping audit
 * all key on `rollingInsightsId`, so the rows it added to close a coverage gap sat outside every
 * pipeline that would have used them. 38,792 of them matched exactly one Rolling Insights row by
 * (name, team). The id was in the same SportsPlayer row the name came from; it was just never
 * selected. `providerIds` carries it now, and `repairNcaafIdentityProviderIds` fills the rows
 * already written.
 */
export function planWidening(
  rows: Array<{
    name: string
    team: string | null
    position: string | null
    source?: string | null
    externalId?: string | null
  }>,
  existingNames: Set<string>,
): { plan: NcaafWideningPlanRow[]; refused: number } {
  const byKey = new Map<string, Omit<NcaafWideningPlanRow, 'providerIds'>>()
  const idsByKey = new Map<string, Map<ProviderIdColumn, Set<string>>>()
  let refused = 0

  for (const row of rows) {
    const team = row.team?.trim()
    /* No team means no way to keep two people of one name apart, so there is no
       safe row to write. Measured as zero on production, kept as a guard. */
    if (!team) continue
    const normalized = normalizePlayerName(row.name ?? '')
    if (!normalized) continue
    if (existingNames.has(normalized)) continue
    if (!looksLikeAPerson(row.name, normalized)) {
      refused += 1
      continue
    }
    const key = identityKey(normalized, team)
    if (!byKey.has(key)) {
      byKey.set(key, {
        canonicalName: row.name.trim(),
        normalizedName: normalized,
        team,
        position: row.position?.trim() || null,
      })
    }
    const column = PROVIDER_ID_COLUMN[String(row.source ?? '').trim().toLowerCase() as keyof typeof PROVIDER_ID_COLUMN]
    const externalId = row.externalId?.trim()
    if (column && externalId) {
      const seen = idsByKey.get(key) ?? new Map<ProviderIdColumn, Set<string>>()
      const ids = seen.get(column) ?? new Set<string>()
      ids.add(externalId)
      seen.set(column, ids)
      idsByKey.set(key, seen)
    }
  }

  return {
    plan: [...byKey.entries()].map(([key, row]) => ({
      ...row,
      providerIds: uniqueProviderIds(idsByKey.get(key) ?? new Map()),
    })),
    refused,
  }
}

/** The (name, team) key a plan row and an identity row are compared on. One definition. */
function identityKey(normalizedName: string, team: string): string {
  return `${normalizedName} ${team}`
}

export async function widenNcaafIdentities(opts?: {
  /**
   * Report what would happen and write nothing.
   *
   * ⚠ DEFAULTS TO TRUE. Writing tens of thousands of rows into the canonical
   * identity table is not something a caller should be able to do by forgetting
   * an argument.
   */
  dryRun?: boolean
  /** Stop after this many inserts. Absent means all of them. */
  limit?: number
}): Promise<NcaafIdentityWidenResult> {
  const dryRun = opts?.dryRun !== false
  const result: NcaafIdentityWidenResult = {
    candidates: 0,
    inserted: 0,
    refused: 0,
    skipped: 0,
    duplicateOfExisting: 0,
    failed: 0,
    dryRun,
  }

  const existingRows = await prisma.playerIdentityMap
    .findMany({ where: { sport: 'NCAAF' }, select: { normalizedName: true } })
    .catch(() => null)
  if (existingRows == null) {
    return { ...result, error: 'could not read the existing NCAAF registry — refusing to write' }
  }
  const existingNames = new Set(existingRows.map((r) => r.normalizedName))

  /*
   * Raw names out of SQL; every rule that decides a KEY is applied in JS. The
   * only thing SQL does here is choose which rows to hand over.
   */
  const source = await prisma.sportsPlayer
    .findMany({
      where: { sport: 'NCAAF', team: { not: null } },
      // source + externalId are what let a new row carry the provider's own id — see planWidening.
      select: { name: true, team: true, position: true, source: true, externalId: true },
    })
    .catch(() => null)
  if (source == null) {
    return { ...result, error: 'could not read SportsPlayer — refusing to write' }
  }

  const { plan, refused } = planWidening(source, existingNames)
  result.candidates = plan.length
  result.refused = refused

  if (dryRun) {
    result.inserted = opts?.limit != null ? Math.min(plan.length, opts.limit) : plan.length
    return result
  }

  for (const row of plan) {
    if (opts?.limit != null && result.inserted >= opts.limit) break

    /*
     * ⚠ RE-CHECKED PER ROW, not only against the snapshot read above. The plan is
     * built once and written over many minutes; another writer landing the same
     * player meanwhile must not produce a second identity for them.
     */
    const exists = await prisma.playerIdentityMap
      .findFirst({
        where: { sport: 'NCAAF', normalizedName: row.normalizedName, currentTeam: row.team },
        select: { id: true },
      })
      .catch(() => null)
    if (exists) {
      result.skipped += 1
      continue
    }

    /*
     * A provider id is a stronger identity than (name, team). If another row already carries it,
     * this is a player the registry holds under a different spelling, and inserting would give
     * one person two identities — the fusion this module exists to prevent, run in reverse.
     */
    if (await providerIdsOwnedElsewhere(row.providerIds, null)) {
      result.duplicateOfExisting += 1
      continue
    }

    await prisma.playerIdentityMap
      .create({
        data: {
          canonicalName: row.canonicalName,
          normalizedName: row.normalizedName,
          currentTeam: row.team,
          position: row.position,
          sport: 'NCAAF',
          ...row.providerIds,
        },
      })
      .then(() => {
        result.inserted += 1
      })
      .catch(() => {
        result.failed += 1
      })
  }

  return result
}

/** Every provider-id column on PlayerIdentityMap. A row with none of them is unjoinable by id. */
const ALL_PROVIDER_ID_COLUMNS = [
  'sleeperId',
  'fantasyCalcId',
  'rollingInsightsId',
  'apiSportsId',
  'mflId',
  'espnId',
  'fleaflickerId',
  'clearSportsId',
  'cfbdId',
  'fantraxId',
] as const

/** Does another NCAAF identity row (not `exceptId`) already carry any of these provider ids? */
async function providerIdsOwnedElsewhere(ids: NcaafProviderIds, exceptId: string | null): Promise<boolean> {
  const or = Object.entries(ids).map(([column, value]) => ({ [column]: value }))
  if (or.length === 0) return false
  const hit = await prisma.playerIdentityMap
    .findFirst({
      where: { sport: 'NCAAF', OR: or, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    })
    .catch(() => null)
  return hit != null
}

export type NcaafIdentityRepairResult = {
  /** NCAAF identity rows carrying no provider id of any kind. */
  idless: number
  /** Of those, rows given at least one id. */
  repairable: number
  /** Ids written (or, dry, that would be), per column. */
  written: Record<ProviderIdColumn, number>
  /** Two identity rows share the key, so neither can be given the id. */
  sharedKey: number
  /** The key maps to more than one distinct id of a provider — two people; not guessed. */
  ambiguousSource: number
  /** The id already belongs to another identity row — same person, other spelling. */
  ownedElsewhere: number
  /** No Rolling Insights or CFBD row under the key (e.g. TheSportsDB-only). */
  noSource: number
  dryRun: boolean
  error?: string
}

/** Rows per bulk UPDATE. ~70ms/row one at a time against this database; 38k rows is 45 minutes. */
const REPAIR_BATCH = 1_000

/**
 * Fill provider ids into NCAAF identity rows that have NONE — the rows the first version of
 * `widenNcaafIdentities` wrote without them.
 *
 * ⚠ THIS IS NOT AN EXCEPTION TO "INSERT-ONLY", AND THE LINE IS PRECISE. The rule forbids
 * overwriting what an existing row carries. This touches only rows carrying NO provider id at
 * all, sets only a column that is NULL (re-checked inside the UPDATE, so a concurrent writer
 * wins), and writes an id only when (name, team) resolves to exactly one id of that provider,
 * no other identity row shares the key, and no other identity row already owns the id. Every
 * guard reports its own count; nothing is skipped silently.
 *
 * DRY RUN IS THE DEFAULT, for the same reason as the insert.
 */
export async function repairNcaafIdentityProviderIds(opts?: {
  dryRun?: boolean
}): Promise<NcaafIdentityRepairResult> {
  const dryRun = opts?.dryRun !== false
  const result: NcaafIdentityRepairResult = {
    idless: 0,
    repairable: 0,
    written: { rollingInsightsId: 0, cfbdId: 0 },
    sharedKey: 0,
    ambiguousSource: 0,
    ownedElsewhere: 0,
    noSource: 0,
    dryRun,
  }

  const registry = await prisma.playerIdentityMap
    .findMany({
      where: { sport: 'NCAAF' },
      select: {
        id: true,
        normalizedName: true,
        currentTeam: true,
        sleeperId: true,
        fantasyCalcId: true,
        rollingInsightsId: true,
        apiSportsId: true,
        mflId: true,
        espnId: true,
        fleaflickerId: true,
        clearSportsId: true,
        cfbdId: true,
        fantraxId: true,
      },
    })
    .catch(() => null)
  if (registry == null) return { ...result, error: 'could not read the NCAAF registry — refusing to write' }

  const hasText = (v: unknown) => typeof v === 'string' && v.trim().length > 0
  const owned: Record<ProviderIdColumn, Set<string>> = { rollingInsightsId: new Set(), cfbdId: new Set() }
  const rowsByKey = new Map<string, number>()
  const idless: Array<{ id: string; key: string }> = []
  for (const row of registry) {
    for (const column of Object.values(PROVIDER_ID_COLUMN)) {
      const value = row[column]
      if (hasText(value)) owned[column].add(String(value).trim())
    }
    const team = row.currentTeam?.trim() ?? ''
    const key = team ? identityKey(row.normalizedName, team) : ''
    if (key) rowsByKey.set(key, (rowsByKey.get(key) ?? 0) + 1)
    if (!ALL_PROVIDER_ID_COLUMNS.some((c) => hasText(row[c]))) idless.push({ id: row.id, key })
  }
  result.idless = idless.length

  const source = await prisma.sportsPlayer
    .findMany({
      where: { sport: 'NCAAF', team: { not: null }, source: { in: Object.keys(PROVIDER_ID_COLUMN) } },
      select: { name: true, team: true, source: true, externalId: true },
    })
    .catch(() => null)
  if (source == null) return { ...result, error: 'could not read SportsPlayer — refusing to write' }

  // Same key rule as the insert: the shared normalizer, the trimmed team.
  const idsByKey = new Map<string, Map<ProviderIdColumn, Set<string>>>()
  for (const row of source) {
    const team = row.team?.trim()
    const normalized = normalizePlayerName(row.name ?? '')
    const column = PROVIDER_ID_COLUMN[row.source as keyof typeof PROVIDER_ID_COLUMN]
    const externalId = row.externalId?.trim()
    if (!team || !normalized || !column || !externalId) continue
    const key = identityKey(normalized, team)
    const seen = idsByKey.get(key) ?? new Map<ProviderIdColumn, Set<string>>()
    const ids = seen.get(column) ?? new Set<string>()
    ids.add(externalId)
    seen.set(column, ids)
    idsByKey.set(key, seen)
  }

  const updates: Record<ProviderIdColumn, Array<{ id: string; value: string }>> = { rollingInsightsId: [], cfbdId: [] }
  const claimed: Record<ProviderIdColumn, Set<string>> = { rollingInsightsId: new Set(), cfbdId: new Set() }
  for (const row of idless) {
    const seen = row.key ? idsByKey.get(row.key) : undefined
    if (!seen) {
      result.noSource += 1
      continue
    }
    if ((rowsByKey.get(row.key) ?? 0) > 1) {
      result.sharedKey += 1
      continue
    }
    let assigned = false
    for (const [column, ids] of seen) {
      if (ids.size !== 1) {
        result.ambiguousSource += 1
        continue
      }
      const value = [...ids][0]
      if (owned[column].has(value) || claimed[column].has(value)) {
        result.ownedElsewhere += 1
        continue
      }
      claimed[column].add(value)
      updates[column].push({ id: row.id, value })
      assigned = true
    }
    if (assigned) result.repairable += 1
  }

  for (const column of Object.values(PROVIDER_ID_COLUMN)) {
    const pending = updates[column]
    if (dryRun) {
      result.written[column] = pending.length
      continue
    }
    // The column name comes from PROVIDER_ID_COLUMN, a closed allowlist — never from input.
    const col = Prisma.raw(`"${column}"`)
    for (let i = 0; i < pending.length; i += REPAIR_BATCH) {
      const batch = pending.slice(i, i + REPAIR_BATCH)
      const values = Prisma.join(batch.map((u) => Prisma.sql`(${u.id}, ${u.value})`))
      const n = await prisma.$executeRaw`
        UPDATE "PlayerIdentityMap" AS p
        SET ${col} = v.value, "updatedAt" = now()
        FROM (VALUES ${values}) AS v(id, value)
        WHERE p.id = v.id AND p.sport = 'NCAAF' AND p.${col} IS NULL
      `
      result.written[column] += Number(n) || 0
    }
  }

  return result
}
