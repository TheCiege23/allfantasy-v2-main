/**
 * Backfill `PlayerIdentityMap.sleeperId` from Sleeper's own player universe.
 *
 * WHY THIS GATES EVERYTHING ELSE. Sleeper is measurably the best NFL source we have for
 * production history and IDP detail — weekly granularity back to 2010, with the full
 * solo/assist tackle split plus passes-defended, QB hits and tackles-for-loss. Rolling
 * Insights reaches only 2018, is season-aggregate only, and carries combined tackles with no
 * split. TheSportsDB carries no NFL statistics at all (biography and images only).
 *
 * But that depth is only reachable for players we can key by Sleeper id, and only 1,026 of
 * 1,933 NFL identity rows (53.1%) carry one. Every unmapped player falls back to a weaker
 * basis and a lower confidence. Closing this gap is worth more than tuning anything
 * downstream of it.
 *
 * Matching is delegated to `resolveVerifiedMatch`: name normalization, then verification by
 * position and team, refusing ambiguity rather than binding on luck. A wrong bind here would
 * attach one player's production history to another — silent, and worse than no match.
 *
 * FILE NAMING IS LOAD-BEARING. This module fetches a provider API directly, which
 * `scripts/check-db-first-api-boundary.mjs` permits only for ingestion/sync modules —
 * matched under `lib/` by the path pattern `(ingest|ingestion|sync)`. It lives here as
 * `sleeperIdentitySync` rather than `backfillSleeperIds` because that is what it is: a sync
 * of provider identity ids into our map. Renaming it away from `sync` will fail CI, and
 * correctly so.
 */

import { prisma } from '@/lib/prisma'

import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch, type NameMatchReason } from './verifiedNameMatch'

const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl'

/**
 * Position families, used as a final safety rail on an otherwise-unique name match.
 *
 * The two vocabularies disagree constantly and harmlessly — `S`/`DB`, `CB`/`DB`, `OT`/`T`,
 * `PK`/`K`, `DL`/`DT` are the same player described differently, and RI's position is
 * sometimes simply wrong (it lists Corbin Bryant, a DT, as `CB`). Measured on the live
 * backfill: 555 of 844 unique-name matches disagreed on the exact position token, but 837
 * agreed on FAMILY and only 7 crossed families.
 *
 * A cross-family disagreement (ours `S`, Sleeper `OT`) is the one shape that might mean two
 * different people sharing a name. Binding wrongly would attach one player's entire
 * production history to another — silent, and far worse than leaving the row unmapped. So
 * those 7 are refused. Sleeper's position should be preferred downstream anyway; RI's is the
 * less reliable of the two.
 */
const POSITION_FAMILY: Record<string, string> = {
  QB: 'SKILL', RB: 'SKILL', WR: 'SKILL', TE: 'SKILL', FB: 'SKILL',
  OT: 'OL', OG: 'OL', C: 'OL', G: 'OL', T: 'OL', OL: 'OL',
  DL: 'DEF', DE: 'DEF', DT: 'DEF', NT: 'DEF', EDGE: 'DEF',
  LB: 'DEF', OLB: 'DEF', ILB: 'DEF', MLB: 'DEF',
  DB: 'DEF', CB: 'DEF', S: 'DEF', SS: 'DEF', FS: 'DEF',
  K: 'ST', PK: 'ST', P: 'ST', LS: 'ST',
}

function positionFamily(position: string | null | undefined): string | null {
  return POSITION_FAMILY[String(position ?? '').trim().toUpperCase()] ?? null
}

/** True when both positions are known AND belong to different families. */
export function isCrossFamilyMismatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = positionFamily(a)
  const fb = positionFamily(b)
  return fa != null && fb != null && fa !== fb
}

interface SleeperPlayer {
  player_id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  position?: string | null
  team?: string | null
  active?: boolean | null
}

/** Candidate shape the verified matcher needs, carrying the id we want. */
interface SleeperCandidate {
  name: string
  position: string | null
  team: string | null
  sleeperId: string
  active: boolean
}

export interface BackfillSleeperIdsResult {
  sport: string
  dryRun: boolean
  universeSize: number
  unmappedBefore: number
  matched: number
  written: number
  byReason: Record<NameMatchReason, number>
  /** Matches refused because that sleeperId is already bound to another identity row. */
  collisionsSkipped: number
  /** Unique-name matches refused because the positions cross families (possible namesake). */
  crossFamilyRefused: number
  crossFamilySamples: string[]
  coverageBefore: string
  coverageAfter: string
  samples: Array<{ name: string; position: string | null; team: string | null; sleeperId: string; reason: string }>
  errors: string[]
}

/**
 * Validate every EXISTING sleeperId against Sleeper's universe and repair the wrong ones.
 *
 * Measured 2026-08-11: of 1,023 pre-existing NFL bindings, 77 pointed at a different human —
 * Jahmyr Gibbs bound to Bill Murray (DT), Lamar Jackson to Cre'Von LeBlanc (DB). Every one of
 * the 858 written by this module's verified matcher was correct, so the corruption predates
 * it. It matters because the id is how weekly stats and projections are fetched: a wrong bind
 * silently attaches one player's production history to another.
 *
 * Repair is CONSERVATIVE. A name mismatch alone does not justify clearing an id, because
 * Sleeper's own naming varies ("Cam Ward" vs our "Cameron Ward") and nulling that would
 * destroy a correct binding. An id is only rewritten when the verified matcher finds a
 * confident DIFFERENT candidate. Everything else is reported for review and left untouched.
 */
export async function repairSleeperIds(opts: { sport?: string; dryRun?: boolean } = {}): Promise<{
  checked: number
  correct: number
  mismatched: number
  repaired: number
  leftForReview: number
  samples: string[]
}> {
  const sport = (opts.sport ?? 'NFL').toUpperCase()
  const dryRun = opts.dryRun ?? false

  const res = await fetch(SLEEPER_PLAYERS_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sleeper player list returned HTTP ${res.status}`)
  const raw = (await res.json()) as Record<string, SleeperPlayer>

  const byId = new Map<string, SleeperCandidate>()
  const candidates: SleeperCandidate[] = []
  for (const [id, p] of Object.entries(raw ?? {})) {
    const name = (p.full_name && p.full_name.trim()) || [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
    if (!name) continue
    const c: SleeperCandidate = {
      name,
      position: p.position ?? null,
      team: p.team ?? null,
      sleeperId: String(p.player_id ?? id),
      active: p.active !== false,
    }
    byId.set(c.sleeperId, c)
    candidates.push(c)
  }
  const index = buildNameIndex(candidates)

  const rows = await prisma.playerIdentityMap.findMany({
    where: { sport, sleeperId: { not: null } },
    select: { id: true, canonicalName: true, position: true, currentTeam: true, sleeperId: true },
  })

  const out = { checked: rows.length, correct: 0, mismatched: 0, repaired: 0, leftForReview: 0, samples: [] as string[] }
  const taken = new Set(rows.map((r) => r.sleeperId).filter((v): v is string => Boolean(v)))

  for (const row of rows) {
    const bound = byId.get(row.sleeperId!)
    if (bound && normalizeMatchName(bound.name) === normalizeMatchName(row.canonicalName)) {
      out.correct++
      continue
    }
    out.mismatched++

    const outcome = resolveVerifiedMatch(index, {
      name: row.canonicalName,
      position: row.position,
      team: row.currentTeam,
    })
    const better = outcome.match
    if (
      !better ||
      better.sleeperId === row.sleeperId ||
      taken.has(better.sleeperId) ||
      isCrossFamilyMismatch(row.position, better.position)
    ) {
      out.leftForReview++
      if (out.samples.length < 12) {
        out.samples.push(`REVIEW  ${row.canonicalName} -> ${row.sleeperId} (${bound?.name ?? 'unknown id'})`)
      }
      continue
    }

    if (out.samples.length < 12) {
      out.samples.push(`REPAIR  ${row.canonicalName}: ${row.sleeperId} (${bound?.name ?? '?'}) -> ${better.sleeperId}`)
    }
    if (!dryRun) {
      taken.delete(row.sleeperId!)
      taken.add(better.sleeperId)
      await prisma.playerIdentityMap.update({
        where: { id: row.id },
        data: { sleeperId: better.sleeperId, lastSyncedAt: new Date() },
      })
    }
    out.repaired++
  }
  return out
}

export async function backfillSleeperIds(opts: { sport?: string; dryRun?: boolean } = {}): Promise<BackfillSleeperIdsResult> {
  const sport = (opts.sport ?? 'NFL').toUpperCase()
  const dryRun = opts.dryRun ?? false
  const errors: string[] = []

  const res = await fetch(SLEEPER_PLAYERS_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sleeper player list returned HTTP ${res.status}`)
  const raw = (await res.json()) as Record<string, SleeperPlayer>

  const candidates: SleeperCandidate[] = []
  for (const [id, p] of Object.entries(raw ?? {})) {
    const name =
      (p.full_name && p.full_name.trim()) ||
      [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
    if (!name) continue
    candidates.push({
      name,
      position: p.position ?? null,
      team: p.team ?? null,
      sleeperId: String(p.player_id ?? id),
      active: p.active !== false,
    })
  }
  const index = buildNameIndex(candidates)

  const [total, mappedBefore] = await Promise.all([
    prisma.playerIdentityMap.count({ where: { sport } }),
    prisma.playerIdentityMap.count({ where: { sport, sleeperId: { not: null } } }),
  ])
  const unmapped = await prisma.playerIdentityMap.findMany({
    where: { sport, sleeperId: null },
    select: { id: true, canonicalName: true, position: true, currentTeam: true },
  })

  // sleeperId is @unique on PlayerIdentityMap, so a second row resolving to an already-bound
  // id must be refused rather than allowed to throw mid-run. Seed from what is already bound.
  const taken = new Set<string>(
    (
      await prisma.playerIdentityMap.findMany({
        where: { sport, sleeperId: { not: null } },
        select: { sleeperId: true },
      })
    )
      .map((r) => r.sleeperId)
      .filter((v): v is string => Boolean(v)),
  )

  const byReason = {
    unique_name: 0,
    position_verified: 0,
    team_verified: 0,
    position_and_team_verified: 0,
    ambiguous: 0,
    not_found: 0,
  } as Record<NameMatchReason, number>

  const result: BackfillSleeperIdsResult = {
    sport,
    dryRun,
    universeSize: candidates.length,
    unmappedBefore: unmapped.length,
    matched: 0,
    written: 0,
    byReason,
    collisionsSkipped: 0,
    crossFamilyRefused: 0,
    crossFamilySamples: [],
    coverageBefore: `${mappedBefore}/${total} (${((mappedBefore / total) * 100).toFixed(1)}%)`,
    coverageAfter: '',
    samples: [],
    errors,
  }

  for (const row of unmapped) {
    const outcome = resolveVerifiedMatch(index, {
      name: row.canonicalName,
      position: row.position,
      team: row.currentTeam,
    })
    byReason[outcome.reason] = (byReason[outcome.reason] ?? 0) + 1
    if (!outcome.match) continue

    // Final safety rail: a unique name that crosses position families may be two different
    // people. Refuse rather than bind one player's history onto another.
    if (isCrossFamilyMismatch(row.position, outcome.match.position)) {
      result.crossFamilyRefused++
      if (result.crossFamilySamples.length < 10) {
        result.crossFamilySamples.push(
          `${row.canonicalName}: ours=${row.position} sleeper=${outcome.match.position}`,
        )
      }
      continue
    }

    const sleeperId = outcome.match.sleeperId
    if (taken.has(sleeperId)) {
      result.collisionsSkipped++
      continue
    }
    result.matched++
    taken.add(sleeperId)

    if (result.samples.length < 10) {
      result.samples.push({
        name: row.canonicalName,
        position: row.position,
        team: row.currentTeam,
        sleeperId,
        reason: outcome.reason,
      })
    }

    if (dryRun) continue
    try {
      await prisma.playerIdentityMap.update({
        where: { id: row.id },
        data: { sleeperId, lastSyncedAt: new Date() },
      })
      result.written++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (errors.length < 20) errors.push(`${row.canonicalName}: ${message.slice(0, 140)}`)
    }
  }

  const mappedAfter = dryRun ? mappedBefore + result.matched : mappedBefore + result.written
  result.coverageAfter = `${mappedAfter}/${total} (${((mappedAfter / total) * 100).toFixed(1)}%)`
  return result
}
