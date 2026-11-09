/**
 * Fill `PlayerIdentityMap.espnId` from Sleeper's own player directory.
 *
 * Each Sleeper player record carries both its `player_id` AND ESPN's id (`espn_id`). For a row that
 * already holds that Sleeper id, the ESPN id is therefore a DIRECT cross-reference from one provider
 * record, not a name match. That is what lets an imported ESPN league reach valuations,
 * projections, headshots and draft names (lib/core-app/rosterIdSpace.ts reads `espnId`).
 *
 * ⚠ WHY THIS EXISTS. Measured on production 2026-11-09: 9,041 NFL identity rows carry a Sleeper
 * id but only 928 carry an ESPN id. All 928 came from the name-matching linker
 * (lib/espn/linkEspnIdentities.ts), capped at 300 athletes a run. Sleeper's directory, which
 * `/api/cron/import-players` already downloads for the Sleeper-id backfill, had the answer for
 * 4,532 more rows the whole time. The Tier-1 crosswalk proven in docs/os/SPORTS_DATA_ESPN_IDENTITY_POPULATION.md
 * had no scheduled caller. Cross-check from the same measurement: of the 568 rows where both
 * sources had an opinion, the name linker and Sleeper agreed on 567.
 *
 * Rules, all of them refusals rather than guesses:
 *   - only FILL a blank: an existing `espnId` is never overwritten, even when Sleeper disagrees
 *     (that is reported, for a human);
 *   - an ESPN id that Sleeper assigns to two different players is ambiguous and never written;
 *   - an ESPN id another NFL row already holds is never written a second time, because two rows
 *     sharing one `espnId` are two athletes (lib/core-app/crosswalkRules.ts);
 *   - no row is created, and nothing but `espnId` is changed.
 *
 * No provider call: the caller hands in the directory it already fetched.
 */
import { prisma } from '@/lib/prisma'

export type SleeperDirectoryEntry = { sleeperId: string; espnId: string | null }
export type IdentityRowIds = { id: string; sleeperId: string | null; espnId: string | null }

export type EspnIdFillPlan = {
  writes: Array<{ id: string; espnId: string }>
  /** ESPN id Sleeper gives to more than one player. */
  refusedAmbiguous: number
  /** ESPN id already on another NFL row. */
  refusedTaken: number
  /** Row already holds an ESPN id and Sleeper names a different one. Left alone. */
  disagreements: number
  /** Row already holds the ESPN id Sleeper names. */
  alreadySet: number
}

export type EspnIdFillSummary = Omit<EspnIdFillPlan, 'writes'> & {
  planned: number
  written: number
  withEspnBefore: number
  dryRun: boolean
  error?: string
}

function clean(value: unknown): string | null {
  const s = value == null ? '' : String(value).trim()
  return s ? s : null
}

/** Sleeper's raw `/players/nfl` map → its id pairs. Pure. */
export function sleeperDirectoryEntries(raw: Record<string, unknown> | null | undefined): SleeperDirectoryEntry[] {
  const out: SleeperDirectoryEntry[] = []
  for (const [key, value] of Object.entries(raw ?? {})) {
    const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    const sleeperId = clean(rec.player_id) ?? clean(key)
    if (!sleeperId) continue
    out.push({ sleeperId, espnId: clean(rec.espn_id) })
  }
  return out
}

/** Decide every write without touching the database. Pure. */
export function planEspnIdFill(directory: readonly SleeperDirectoryEntry[], rows: readonly IdentityRowIds[]): EspnIdFillPlan {
  const plan: EspnIdFillPlan = { writes: [], refusedAmbiguous: 0, refusedTaken: 0, disagreements: 0, alreadySet: 0 }

  const espnBySleeper = new Map<string, string>()
  const sleepersByEspn = new Map<string, Set<string>>()
  for (const entry of directory) {
    if (!entry.espnId) continue
    espnBySleeper.set(entry.sleeperId, entry.espnId)
    if (!sleepersByEspn.has(entry.espnId)) sleepersByEspn.set(entry.espnId, new Set())
    sleepersByEspn.get(entry.espnId)!.add(entry.sleeperId)
  }

  const taken = new Set(rows.map((r) => r.espnId).filter((v): v is string => Boolean(v)))
  for (const row of rows) {
    if (!row.sleeperId) continue
    const espnId = espnBySleeper.get(row.sleeperId)
    if (!espnId) continue
    if (row.espnId) {
      if (row.espnId === espnId) plan.alreadySet++
      else plan.disagreements++
      continue
    }
    if ((sleepersByEspn.get(espnId)?.size ?? 0) > 1) {
      plan.refusedAmbiguous++
      continue
    }
    if (taken.has(espnId)) {
      plan.refusedTaken++
      continue
    }
    taken.add(espnId)
    plan.writes.push({ id: row.id, espnId })
  }
  return plan
}

const WRITE_CHUNK = 500

/**
 * Plan and apply the fill for one sport's identity rows. Idempotent: a second run finds every
 * filled row `alreadySet`. The UPDATE re-checks `espnId IS NULL`, so a concurrent writer that got
 * there first wins and is never overwritten.
 */
export async function fillEspnIdsFromSleeperDirectory(
  raw: Record<string, unknown> | null | undefined,
  opts: { sport?: string; dryRun?: boolean; isExhausted?: () => boolean } = {},
): Promise<EspnIdFillSummary> {
  const sport = (opts.sport ?? 'NFL').toUpperCase()
  const dryRun = opts.dryRun === true
  const summary: EspnIdFillSummary = {
    planned: 0,
    written: 0,
    withEspnBefore: 0,
    refusedAmbiguous: 0,
    refusedTaken: 0,
    disagreements: 0,
    alreadySet: 0,
    dryRun,
  }

  const directory = sleeperDirectoryEntries(raw)
  if (!directory.some((e) => e.espnId)) return summary

  const rows = (await prisma.playerIdentityMap.findMany({
    where: { sport, OR: [{ sleeperId: { not: null } }, { espnId: { not: null } }] },
    select: { id: true, sleeperId: true, espnId: true },
  })) as IdentityRowIds[]
  summary.withEspnBefore = rows.filter((r) => r.espnId).length

  const { writes, ...counts } = planEspnIdFill(directory, rows)
  Object.assign(summary, counts)
  summary.planned = writes.length
  if (dryRun) return summary

  for (let i = 0; i < writes.length; i += WRITE_CHUNK) {
    if (opts.isExhausted?.()) break
    const chunk = writes.slice(i, i + WRITE_CHUNK)
    const ids = chunk.map((w) => w.id)
    const espnIds = chunk.map((w) => w.espnId)
    summary.written += await prisma.$executeRaw`
      UPDATE "PlayerIdentityMap" AS p
      SET "espnId" = v.espn_id, "updatedAt" = NOW()
      FROM unnest(${ids}::text[], ${espnIds}::text[]) AS v(id, espn_id)
      WHERE p.id = v.id AND p."espnId" IS NULL
    `
  }
  return summary
}
