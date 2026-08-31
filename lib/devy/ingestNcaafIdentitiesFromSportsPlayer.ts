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
  failed: number
  dryRun: boolean
  error?: string
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
export function planWidening(
  rows: Array<{ name: string; team: string | null; position: string | null }>,
  existingNames: Set<string>,
): { plan: Array<{ canonicalName: string; normalizedName: string; team: string; position: string | null }>; refused: number } {
  const byKey = new Map<
    string,
    { canonicalName: string; normalizedName: string; team: string; position: string | null }
  >()
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
    const key = `${normalized} ${team}`
    if (!byKey.has(key)) {
      byKey.set(key, {
        canonicalName: row.name.trim(),
        normalizedName: normalized,
        team,
        position: row.position?.trim() || null,
      })
    }
  }

  return { plan: [...byKey.values()], refused }
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
      select: { name: true, team: true, position: true },
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

    await prisma.playerIdentityMap
      .create({
        data: {
          canonicalName: row.canonicalName,
          normalizedName: row.normalizedName,
          currentTeam: row.team,
          position: row.position,
          sport: 'NCAAF',
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
