import 'server-only'

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  PARAM_BATCHES,
  simulateOddsBands,
  simulateSeason,
  type OddsCounts,
  type SimInput,
  type SimTally,
  type TeamBands,
} from './outlookSim'

/**
 * Season Outlook — one stored simulation per league, reused until its inputs change.
 *
 * ── WHY PER LEAGUE, AND WHY IT IS SHARED ACROSS USERS ─────────────────────────────────────────
 * A league's simulation does not depend on who is looking at it: every team's odds come out of the
 * same run. So twelve managers in one league pay for one run between them, and a 63-league account
 * pays only for the leagues whose inputs moved since anyone last looked. That is what lets the
 * headline stay at the full iteration count instead of falling toward the floor on a big account.
 *
 * ── 🛑 ONE ROW PER LEAGUE, WITH THE INPUT HASH INSIDE IT — NOT A KEY PER INPUT ────────────────
 * Keying on the hash is the obvious design and it leaks. The hourly `SportsDataCache` purge is an
 * ALLOW-LIST of key families (`PURGEABLE_KEY_PREFIXES` in `lib/enrichment-cache.ts`, since
 * 2026-09-17), and this family is not on it — before that purge, 3,448 of 4,436 rows sat expired —
 * while a league's inputs change every time a week is scored. A hashed key would leave a dead row
 * per league per score update. One row per league is overwritten in place, so the table holds
 * exactly one entry per league anyone has opened, purge or no purge. (Reads here filter on
 * `expiresAt`, so adding this prefix to that allow-list later would be safe.)
 *
 * ⚠ THE HASH COVERS EVERYTHING THE RUN READS, PLUS THE MODEL VERSION. Change the model and forget to
 * bump `MODEL_VERSION` and every league keeps serving numbers from the old model until its next score
 * update — plausible, wrong, and invisible. Bump it.
 */

/** Bump whenever `outlookSim.ts` changes what a given input produces. */
export const MODEL_VERSION = 2

const KEY_PREFIX = 'core-outlook:league:v1:'
/** Long, because the hash decides validity; the TTL only bounds a league nobody opens again. */
const TTL_MS = 21 * 24 * 60 * 60 * 1000

export type LeagueSimResult = {
  model: number
  hash: string
  iterations: number
  bandBatches: number
  bandRunsPerBatch: number
  counts: Record<string, OddsCounts>
  bands: Record<string, TeamBands>
  cut: SimTally['cut']
  finishes: SimTally['finishes']
  computedAt: string
  /** When the scheduled pre-compute last confirmed these inputs unchanged. Absent until it has. */
  checkedAt?: string
}

export function leagueSimCacheKey(platformLeagueId: string): string {
  return `${KEY_PREFIX}${platformLeagueId}`
}

const fixed = (n: number, d: number) => (Number.isFinite(n) ? n.toFixed(d) : 'x')

/** A digest of exactly what `computeLeagueSim` reads. */
export function leagueSimHash(sim: SimInput, seed: number): string {
  const teams = [...sim.teams]
    .sort((a, b) => a.rosterId.localeCompare(b.rosterId))
    .map((t) =>
      [
        t.rosterId,
        t.wins,
        t.losses,
        fixed(t.pointsFor, 2),
        t.profile ? `${fixed(t.profile.mu, 3)}/${fixed(t.profile.sigma, 3)}/${t.profile.n}` : '-',
      ].join(':'),
    )
  const games = sim.remaining.map((g) => `${g.week}:${g.a}:${g.b}`).sort()
  const body = [
    `m${MODEL_VERSION}`,
    `s${seed}`,
    `p${sim.playoffTeams}`,
    `b${sim.byeTeams}`,
    teams.join('|'),
    games.join('|'),
  ].join('#')
  return createHash('sha1').update(body).digest('hex').slice(0, 20)
}

/** How expensive a league is to run, in simulated games — the unit the page budget is set in. */
export function leagueSimCost(sim: SimInput, iterations: number): number {
  /* The range run plays half as many seasons again. */
  return Math.max(1, sim.remaining.length) * iterations * 1.5
}

export function computeLeagueSim(sim: SimInput, seed: number, iterations: number, now = new Date()): LeagueSimResult {
  const tally = simulateSeason(sim, { iterations, seed })
  const bandIterations = Math.floor(iterations / 2)
  const bandRunsPerBatch = Math.max(100, Math.floor(bandIterations / PARAM_BATCHES))
  const bands = simulateOddsBands(sim, { iterations: bandIterations, seed })
  return {
    model: MODEL_VERSION,
    hash: leagueSimHash(sim, seed),
    iterations: tally.iterations,
    bandBatches: PARAM_BATCHES,
    bandRunsPerBatch,
    counts: tally.counts,
    bands,
    cut: tally.cut,
    finishes: tally.finishes,
    computedAt: now.toISOString(),
  }
}

function isResult(value: unknown): value is LeagueSimResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<LeagueSimResult>
  return (
    v.model === MODEL_VERSION &&
    typeof v.hash === 'string' &&
    typeof v.iterations === 'number' &&
    !!v.counts &&
    !!v.bands &&
    !!v.cut &&
    !!v.finishes &&
    typeof v.computedAt === 'string'
  )
}

/** Stored runs by platform league id. A row whose model version differs is ignored. */
export async function readLeagueSims(platformLeagueIds: readonly string[], now = new Date()): Promise<Map<string, LeagueSimResult>> {
  const out = new Map<string, LeagueSimResult>()
  if (platformLeagueIds.length === 0) return out
  const rows = await prisma.sportsDataCache
    .findMany({
      where: { cacheKey: { in: platformLeagueIds.map(leagueSimCacheKey) }, expiresAt: { gt: now } },
      select: { cacheKey: true, data: true },
    })
    .catch(() => [])
  for (const row of rows) {
    if (!isResult(row.data)) continue
    out.set(row.cacheKey.slice(KEY_PREFIX.length), row.data)
  }
  return out
}

/**
 * When each league was last looked at by the scheduled pre-compute, whatever it found — a stored run
 * or a marker. The page never reads markers; `readLeagueSims` rejects them.
 */
export async function readLeagueSimStamps(platformLeagueIds: readonly string[], now = new Date()): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (platformLeagueIds.length === 0) return out
  const rows = await prisma.sportsDataCache
    .findMany({
      where: { cacheKey: { in: platformLeagueIds.map(leagueSimCacheKey) }, expiresAt: { gt: now } },
      select: { cacheKey: true, data: true },
    })
    .catch(() => [])
  for (const row of rows) {
    const d = (row.data ?? {}) as { checkedAt?: unknown; computedAt?: unknown }
    const at = Date.parse(String(d.checkedAt ?? d.computedAt ?? ''))
    if (Number.isFinite(at)) out.set(row.cacheKey.slice(KEY_PREFIX.length), at)
  }
  return out
}

/**
 * 🛑 A LEAGUE THE PRE-COMPUTE CANNOT RUN STILL GETS A ROW, OR IT STARVES THE QUEUE.
 *
 * Measured on production in the first two fires after launch (2026-09-17 17:18Z / 17:30Z): leagues it
 * could not simulate (too few scored weeks, no League row) wrote nothing, so they had no check time,
 * sorted FIRST as "never checked", and took their slots again on every fire — 3 skipped, then 5, with
 * `computed + skipped` already at the 12-league cap. Left alone, the skips grow until no fire computes
 * anything. Same failure, same cure as the portfolio writer's empty daily record.
 *
 * A marker carries no `counts`, so `readLeagueSims` never serves it and the page treats the league as
 * a miss. It is overwritten by the first real run.
 */
export async function writeLeagueSimMarker(
  platformLeagueId: string,
  reason: 'unsimulated' | 'failed',
  now = new Date(),
): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + TTL_MS)
  const data = { model: MODEL_VERSION, marker: reason, checkedAt: new Date().toISOString() }
  try {
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: leagueSimCacheKey(platformLeagueId) },
      create: { cacheKey: leagueSimCacheKey(platformLeagueId), data, expiresAt },
      update: { data, expiresAt },
    })
    return true
  } catch {
    return false
  }
}

/** Never throws: a failed write costs a recompute next time, nothing more. */
export async function writeLeagueSims(entries: ReadonlyArray<[string, LeagueSimResult]>, now = new Date()): Promise<number> {
  const expiresAt = new Date(now.getTime() + TTL_MS)
  const results = await Promise.allSettled(
    entries.map(([pid, result]) =>
      prisma.sportsDataCache.upsert({
        where: { cacheKey: leagueSimCacheKey(pid) },
        create: { cacheKey: leagueSimCacheKey(pid), data: result as unknown as object, expiresAt },
        update: { data: result as unknown as object, expiresAt },
      }),
    ),
  )
  return results.filter((r) => r.status === 'fulfilled').length
}
