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
 * ── Second pass: the ESPN players Sleeper's record does not name ─────────────
 *
 * ⚠ SLEEPER'S DIRECTORY HAS HOLES EXACTLY WHERE IT HURTS. Measured on production 2026-11-09,
 * among the ESPN athletes we already hold from imported leagues (`PlayerProviderIdentity`,
 * provider `espn`), 545 reach no `PlayerIdentityMap` row even after the fill above. They include
 * James Cook III (Sleeper search rank 5), Kenneth Walker III (17), Travis Etienne Jr., Kyle
 * Pitts Sr., Marvin Harrison Jr., Brian Thomas Jr. and Cam Ward. Their Sleeper records carry no
 * `espn_id`, so the direct pass cannot reach them. The name linker cannot either: our canonical
 * `Player` table holds two identical James Cook rows, so the matcher sees a tie and refuses. It
 * linked Etienne and Pitts to the copy that has no Sleeper identity, so the id chain dead-ends.
 *
 * So this pass skips the canonical table. It matches each ESPN athlete straight to Sleeper's
 * record on TWO facts: the same normalized name AND the same birthday. A name alone is never
 * enough (lib/player-identity/matchProviderAthlete.ts). Checked against the 914 identity rows
 * where both an ESPN id and this match exist: 914 agree, 0 disagree. It writes about 57 rows.
 *
 * Its refusals, on top of the ones above:
 *   - exactly one Sleeper record may carry that name and birthday; two is a tie, not a choice;
 *   - two ESPN athletes landing on one Sleeper record are both dropped;
 *   - a Sleeper record that names a DIFFERENT ESPN id is believed over the match;
 *   - an ESPN id held on two identity rows with different names or birthdays is dropped.
 *
 * No provider call: the caller hands in the directory it already fetched.
 */
import { prisma } from '@/lib/prisma'
import { birthDay } from '@/lib/player-identity/matchProviderAthlete'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

type SleeperDirectoryEntry = {
  sleeperId: string
  espnId: string | null
  /** Sleeper's `full_name`. Only the birthday pass reads it. */
  name?: string | null
  /** Sleeper's `birth_date`, as YYYY-MM-DD. Only the birthday pass reads it. */
  birthDate?: string | null
}
/** An ESPN athlete we already hold, from `PlayerProviderIdentity` (provider `espn`). */
type EspnAthlete = { espnId: string; name: string | null; dob: string | null }
type IdentityRowIds = { id: string; sleeperId: string | null; espnId: string | null }

type EspnIdFillPlan = {
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

type EspnBirthdayMatchPlan = {
  writes: Array<{ id: string; espnId: string }>
  /** ESPN athletes with no name or no birthday to match on. */
  noEvidence: number
  /** No Sleeper record shares the name and the birthday. */
  noMatch: number
  /** Two Sleeper records share it, or two ESPN athletes landed on one record. */
  refusedAmbiguous: number
  /** The matched Sleeper record names a different ESPN id. */
  refusedSleeperDisagrees: number
  /** One ESPN id on two identity rows that disagree about who it is. */
  refusedInconsistent: number
  /** The matched Sleeper id has no PlayerIdentityMap row, or that row holds an ESPN id already. */
  noTargetRow: number
}

export type EspnIdFillSummary = Omit<EspnIdFillPlan, 'writes'> & {
  planned: number
  written: number
  withEspnBefore: number
  dryRun: boolean
  /** The second pass: ESPN athletes matched to Sleeper records by name and birthday. */
  byBirthday?: Omit<EspnBirthdayMatchPlan, 'writes'> & { planned: number; error?: string }
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
    const name = clean(rec.full_name) ?? clean([rec.first_name, rec.last_name].filter(Boolean).join(' '))
    out.push({ sleeperId, espnId: clean(rec.espn_id), name, birthDate: birthDay(clean(rec.birth_date)) || null })
  }
  return out
}

function matchKey(name: string | null | undefined, dob: string | null | undefined): string | null {
  const n = normalizePlayerName(name)
  const d = birthDay(dob)
  return n && d ? `${n}|${d}` : null
}

/**
 * The second pass. Pure, and safe to plan from the same rows as the first pass. The two cannot
 * collide: every id the first pass writes is named by a Sleeper record, which this pass leaves
 * alone. Every row it fills belongs to a Sleeper record naming that id, which this pass will
 * not match to a different one.
 */
export function planEspnIdBirthdayMatch(
  directory: readonly SleeperDirectoryEntry[],
  athletes: readonly EspnAthlete[],
  rows: readonly IdentityRowIds[],
): EspnBirthdayMatchPlan {
  const plan: EspnBirthdayMatchPlan = {
    writes: [],
    noEvidence: 0,
    noMatch: 0,
    refusedAmbiguous: 0,
    refusedSleeperDisagrees: 0,
    refusedInconsistent: 0,
    noTargetRow: 0,
  }

  const taken = new Set(rows.map((r) => r.espnId).filter((v): v is string => Boolean(v)))
  const namedBySleeper = new Set(directory.map((e) => e.espnId).filter((v): v is string => Boolean(v)))

  /* One ESPN id can sit on several identity rows (one per league key). They must agree. */
  const keyByEspn = new Map<string, string | null>()
  const inconsistent = new Set<string>()
  for (const a of athletes) {
    if (!a.espnId || a.espnId.startsWith('-')) continue // a D/ST, named from its id elsewhere
    if (taken.has(a.espnId) || namedBySleeper.has(a.espnId)) continue // the first pass owns these
    const key = matchKey(a.name, a.dob)
    if (!keyByEspn.has(a.espnId)) keyByEspn.set(a.espnId, key)
    else if (keyByEspn.get(a.espnId) !== key) inconsistent.add(a.espnId)
  }

  const sleeperByKey = new Map<string, SleeperDirectoryEntry[]>()
  for (const entry of directory) {
    const key = matchKey(entry.name, entry.birthDate)
    if (!key) continue
    const bucket = sleeperByKey.get(key)
    if (bucket) bucket.push(entry)
    else sleeperByKey.set(key, [entry])
  }

  const candidates = new Map<string, string[]>() // sleeperId -> espn ids that matched it
  for (const [espnId, key] of keyByEspn) {
    if (inconsistent.has(espnId)) {
      plan.refusedInconsistent++
      continue
    }
    if (!key) {
      plan.noEvidence++
      continue
    }
    const hits = sleeperByKey.get(key) ?? []
    if (hits.length === 0) {
      plan.noMatch++
      continue
    }
    if (hits.length > 1) {
      plan.refusedAmbiguous++
      continue
    }
    const hit = hits[0]!
    if (hit.espnId && hit.espnId !== espnId) {
      plan.refusedSleeperDisagrees++
      continue
    }
    const bucket = candidates.get(hit.sleeperId)
    if (bucket) bucket.push(espnId)
    else candidates.set(hit.sleeperId, [espnId])
  }

  const rowBySleeper = new Map<string, IdentityRowIds>()
  for (const row of rows) if (row.sleeperId) rowBySleeper.set(row.sleeperId, row)

  for (const [sleeperId, espnIds] of candidates) {
    if (espnIds.length > 1) {
      plan.refusedAmbiguous += espnIds.length
      continue
    }
    const espnId = espnIds[0]!
    const row = rowBySleeper.get(sleeperId)
    if (!row || row.espnId) {
      plan.noTargetRow++
      continue
    }
    taken.add(espnId)
    plan.writes.push({ id: row.id, espnId })
  }
  return plan
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
  /* An empty or degraded download proves nothing about anyone; it costs no query. */
  if (!directory.some((e) => e.espnId)) return summary

  const rows = (await prisma.playerIdentityMap.findMany({
    where: { sport, OR: [{ sleeperId: { not: null } }, { espnId: { not: null } }] },
    select: { id: true, sleeperId: true, espnId: true },
  })) as IdentityRowIds[]
  summary.withEspnBefore = rows.filter((r) => r.espnId).length

  const { writes: directWrites, ...counts } = planEspnIdFill(directory, rows)
  Object.assign(summary, counts)
  const writes = [...directWrites]

  /* The second pass's failure never costs the first pass's writes: it is reported on
     `byBirthday` instead. */
  try {
    const athletes = (
      await prisma.playerProviderIdentity.findMany({
        where: { provider: 'espn', sportKey: sport },
        select: { providerPlayerId: true, displayName: true, rawPayload: true },
      })
    ).map((a) => ({
      espnId: a.providerPlayerId,
      name: a.displayName,
      dob: clean((a.rawPayload as Record<string, unknown> | null)?.dob),
    }))
    const { writes: birthdayWrites, ...birthdayCounts } = planEspnIdBirthdayMatch(directory, athletes, rows)
    summary.byBirthday = { ...birthdayCounts, planned: birthdayWrites.length }
    writes.push(...birthdayWrites)
  } catch (err) {
    summary.byBirthday = {
      planned: 0,
      noEvidence: 0,
      noMatch: 0,
      refusedAmbiguous: 0,
      refusedSleeperDisagrees: 0,
      refusedInconsistent: 0,
      noTargetRow: 0,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    }
  }

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
