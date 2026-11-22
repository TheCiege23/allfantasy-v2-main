import 'server-only'

import { prisma } from '@/lib/prisma'
import { nflSeasonFor } from '@/lib/chimmy-outcomes/ledgerGrading'
import { recordTopWaiverClaim, type PanelWaiverAdviceOutcome } from '@/lib/chimmy-advice/panelWaiverAdvice'
import { WAIVER_ENGINE_SURFACE } from '@/lib/chimmy-advice/adviceSurfaces'
import { resolveDecisionOsFeedFlags } from '@/lib/decision-os/flags'
import { isWaiverCalibrationScope, type WaiverScopeLeague } from './calibration'
import type { WaiverClaimRecommendation } from './decision'

/**
 * THE WAIVER ENGINE ON A SCHEDULE (Waiver OS, 2026-11-20 re-score push).
 *
 * The engine ran only when somebody asked — the waiver panel, or a Chimmy waiver question — so how
 * good its #1 claim is had to be learned from whoever happened to open the panel. This runs it once a
 * week for every league the ledger can measure and records its #1 claim (surface `waiver_engine`, shown
 * to nobody) with the engine's raw score. The ledger grades those claims three weeks on, and the
 * engine's confidence learns from them (`calibration.ts`). That is the consumer: nothing here is sent to
 * anyone.
 *
 * 🛑 ONLY LEAGUES THE LEDGER CAN MEASURE: Sleeper (the ledger grades by Sleeper id —
 * `resolveWaiverAddTarget`), NFL, redraft, full PPR (`isWaiverCalibrationScope`). A claim the ledger
 * cannot grade is a run wasted.
 *
 * 🛑 BOUNDED, AND IT ROTATES. Each tick starts leagues until `budgetMs` or `limit` runs out, oldest
 * attempt first, and never re-runs a league attempted in the last ATTEMPT_TTL_MS — including one with
 * nothing to claim, so an empty wire costs one run a week, not one every fifteen minutes. Attempts are
 * kept in one small `sportsDataCache` row, so the rotation holds across replicas and restarts.
 *
 * ⚠ IT RUNS THE REAL ENGINE, THE SAME WAY A CHIMMY WAIVER QUESTION DOES (`loadWaiverDecisionSlice`):
 * deterministic, no LLM. The panel and Chimmy record the same pick for the same week over this row, so a
 * claim somebody was actually shown always wins (`lib/chimmy-advice/adviceStore.ts`).
 *
 * Never throws: a league that fails is recorded as attempted and counted as `error`.
 */

export const WAIVER_ENGINE_WEEKLY_ATTEMPTS_KEY = 'waiver-engine-weekly:attempts:v1'
/** A league is run at most once in this window. */
export const ATTEMPT_TTL_MS = 6 * 86_400_000
/** Leagues one tick may start. */
export const WAIVER_ENGINE_WEEKLY_LIMIT = 25
/** Candidate leagues read per tick, by id. */
const CANDIDATE_READ_MAX = 5000

export type WeeklyEngineOutcome = PanelWaiverAdviceOutcome | 'out_of_scope' | 'no_decision' | 'error'

export type WeeklyEngineRun =
  | {
      ran: false
      /** `waiverDecision` switched off (the same kill switch Chimmy's waiver slice honours), or the ledger's waiver half off. */
      reason: 'feed_disabled' | 'ledger_off'
    }
  | WeeklyEngineRanRun

export type WeeklyEngineRanRun = {
  ran: true
  candidates: number
  due: number
  started: number
  recorded: number
  outcomes: Partial<Record<WeeklyEngineOutcome, number>>
  budgetStopped: boolean
}

type Candidate = { id: string; userId: string }

export type WeeklyEngineDeps = {
  now: () => number
  /** False when the `waiverDecision` feed is switched off. */
  feedEnabled: () => Promise<boolean>
  env: NodeJS.ProcessEnv
  loadCandidates: (season: number) => Promise<Candidate[]>
  loadScopeLeague: (leagueId: string) => Promise<WaiverScopeLeague | null>
  readAttempts: () => Promise<Record<string, number>>
  writeAttempts: (attempts: Record<string, number>) => Promise<void>
  /** The engine's claims for this user and league, as a Chimmy waiver question would get them. */
  runEngine: (userId: string, leagueId: string) => Promise<readonly WaiverClaimRecommendation[] | null>
  record: (args: { userId: string; leagueId: string; claims: readonly WaiverClaimRecommendation[] }) => Promise<PanelWaiverAdviceOutcome>
}

const key = (c: Candidate) => `${c.userId}|${c.id}`

/** Pure: which candidates are due, oldest attempt first (never-attempted first of all), and the pruned map. */
export function dueCandidates(
  candidates: readonly Candidate[],
  attempts: Record<string, number>,
  nowMs: number,
): { due: Candidate[]; kept: Record<string, number> } {
  const kept: Record<string, number> = {}
  for (const [k, at] of Object.entries(attempts)) {
    if (typeof at === 'number' && Number.isFinite(at) && nowMs - at < ATTEMPT_TTL_MS) kept[k] = at
  }
  const due = candidates.filter((c) => c.id && c.userId && kept[key(c)] == null)
  return { due, kept }
}

export async function runWeeklyWaiverEngineCalls(
  opts: { budgetMs: number; limit?: number },
  deps: WeeklyEngineDeps = defaultWeeklyEngineDeps,
): Promise<WeeklyEngineRun> {
  if (String(deps.env['ADVICE_LEDGER_WAIVERS'] ?? '').trim().toLowerCase() === 'off') return { ran: false, reason: 'ledger_off' }
  if (!(await deps.feedEnabled().catch(() => false))) return { ran: false, reason: 'feed_disabled' }
  const started = deps.now()
  const limit = Math.max(0, opts.limit ?? WAIVER_ENGINE_WEEKLY_LIMIT)
  const season = nflSeasonFor(new Date(started))
  const outcomes: WeeklyEngineRanRun['outcomes'] = {}
  const bump = (o: WeeklyEngineOutcome) => {
    outcomes[o] = (outcomes[o] ?? 0) + 1
  }

  const [candidates, attempts] = await Promise.all([
    deps.loadCandidates(season).catch(() => [] as Candidate[]),
    deps.readAttempts().catch(() => ({}) as Record<string, number>),
  ])
  const { due, kept } = dueCandidates(candidates, attempts, started)

  let startedCount = 0
  let recorded = 0
  let budgetStopped = false
  for (const c of due) {
    if (startedCount >= limit) break
    if (deps.now() - started >= opts.budgetMs) {
      budgetStopped = true
      break
    }
    startedCount++
    kept[key(c)] = deps.now()
    try {
      const league = await deps.loadScopeLeague(c.id)
      if (!isWaiverCalibrationScope(league)) {
        bump('out_of_scope')
        continue
      }
      const claims = await deps.runEngine(c.userId, c.id)
      if (!claims) {
        bump('no_decision')
        continue
      }
      const outcome = await deps.record({ userId: c.userId, leagueId: c.id, claims })
      bump(outcome)
      if (outcome === 'recorded') recorded++
    } catch {
      bump('error')
    }
  }

  if (startedCount > 0) await deps.writeAttempts(kept).catch(() => undefined)
  return { ran: true, candidates: candidates.length, due: due.length, started: startedCount, recorded, outcomes, budgetStopped }
}

export const defaultWeeklyEngineDeps: WeeklyEngineDeps = {
  now: () => Date.now(),
  feedEnabled: async () => (await resolveDecisionOsFeedFlags()).enabled('waiverDecision'),
  env: process.env,
  loadCandidates: async (season) =>
    prisma.league.findMany({
      where: {
        sport: 'NFL',
        season,
        isDynasty: false,
        platform: { equals: 'sleeper', mode: 'insensitive' },
        OR: [{ leagueType: null }, { leagueType: 'redraft' }],
      },
      select: { id: true, userId: true },
      orderBy: { id: 'asc' },
      take: CANDIDATE_READ_MAX,
    }),
  loadScopeLeague: async (leagueId) => {
    const l = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true, isDynasty: true, leagueType: true, scoring: true, settings: true, starters: true },
    })
    return l ? { ...l, sport: String(l.sport) } : null
  },
  readAttempts: async () => {
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: WAIVER_ENGINE_WEEKLY_ATTEMPTS_KEY }, select: { data: true } })
    const data = row?.data
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, number>) : {}
  },
  writeAttempts: async (attempts) => {
    const expiresAt = new Date(Date.now() + 2 * ATTEMPT_TTL_MS)
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: WAIVER_ENGINE_WEEKLY_ATTEMPTS_KEY },
      create: { cacheKey: WAIVER_ENGINE_WEEKLY_ATTEMPTS_KEY, data: attempts, expiresAt },
      update: { data: attempts, expiresAt },
    })
  },
  runEngine: async (userId, leagueId) => {
    const { loadWaiverDecisionSlice } = await import('@/lib/decision-os/grounding/decisionBridge')
    let claims: readonly WaiverClaimRecommendation[] | null = null
    await loadWaiverDecisionSlice({
      userId,
      leagueId,
      onClaims: (c) => {
        claims = c
      },
    })
    return claims
  },
  record: (args) => recordTopWaiverClaim({ ...args, surface: WAIVER_ENGINE_SURFACE, scored: true }),
}
