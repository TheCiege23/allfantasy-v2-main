/**
 * Which tribes are safe from Tribal Council this week, and which one attends.
 *
 * One answer, shared by the necklace award (survivorTribeImmunity.ts) and the council opener
 * (gameStateMachine.triggerTribalOpen), so the tribe that is told it won immunity is also the
 * tribe the council never sends. Three inputs feed it:
 *
 *  - the week's counted tribe totals (highest tribe is immune; the two highest when the
 *    `twoHighestTribesImmune` rule is on and there are at least three tribes),
 *  - a `tribe_immunity` challenge reward recorded this week (SurvivorEffectEngine audit rows),
 *  - the score sync's own `survivorGameState.immuneTribeId`, kept as a fallback when the totals
 *    have not been loaded.
 *
 * At least one tribe always attends: immunity never covers every active tribe. The pure helpers
 * at the top are what the tests exercise; the loader at the bottom is the one callers use.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

import { getWeeklyEffectState } from './SurvivorEffectEngine'
import { normalizeSurvivorFoundationSettings, type SurvivorFoundationSettings } from './normalizeSurvivorSettings'

type Db = Prisma.TransactionClient | PrismaClient

export interface TribeScoreRow {
  tribeId: string | null
  finalScore: number
  countedTowardTribeTotal?: boolean | null
}

/** Sum of counted, finite scores per tribe. Uncounted rows (Exile, sit-outs) never add to a tribe. */
export function tribeTotals(scores: readonly TribeScoreRow[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const score of scores) {
    if (!score.tribeId || score.countedTowardTribeTotal === false || !Number.isFinite(score.finalScore)) continue
    totals.set(score.tribeId, (totals.get(score.tribeId) ?? 0) + score.finalScore)
  }
  return totals
}

/** Highest total first; an exact tie breaks on tribe id so the pick is reproducible. */
export function rankTribesByTotal(totals: ReadonlyMap<string, number>): string[] {
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tribeId]) => tribeId)
}

export interface PickImmuneTribesInput {
  totals: ReadonlyMap<string, number>
  /** Every active tribe. The pick never leaves fewer than one of them to attend. */
  tribeIds: readonly string[]
  /** The two highest-scoring tribes are safe (needs three or more tribes; otherwise one). */
  twoHighest: boolean
  /** Tribes that won immunity through a challenge reward this week. They are safe first. */
  rewardTribeIds?: readonly string[]
  /**
   * The score sync's pick (`survivorGameState.immuneTribeId`). While it is an active tribe it IS the
   * top tribe, so the totals only decide the second safe tribe under the two-highest rule.
   */
  scoreImmuneTribeId?: string | null
}

/**
 * Immune tribes in priority order: challenge winners, then the top-scoring tribe(s). Trimmed from
 * the end so that at least one tribe can attend.
 */
export function pickImmuneTribeIds(input: PickImmuneTribesInput): string[] {
  const active = new Set(input.tribeIds)
  if (active.size < 2) return []
  const limit = active.size - 1
  const wanted = input.twoHighest && active.size >= 3 ? 2 : 1
  const ranked = rankTribesByTotal(input.totals).filter((tribeId) => active.has(tribeId))
  const immune: string[] = []
  const add = (tribeId: string | null | undefined) => {
    if (tribeId && active.has(tribeId) && !immune.includes(tribeId)) immune.push(tribeId)
  }
  const rankOf = (tribeId: string) => (ranked.includes(tribeId) ? ranked.indexOf(tribeId) : Number.MAX_SAFE_INTEGER)
  for (const tribeId of [...new Set(input.rewardTribeIds ?? [])].sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b))) add(tribeId)
  const scoreBased: string[] = []
  if (input.scoreImmuneTribeId && active.has(input.scoreImmuneTribeId)) scoreBased.push(input.scoreImmuneTribeId)
  for (const tribeId of ranked) {
    if (scoreBased.length >= wanted) break
    if (!scoreBased.includes(tribeId)) scoreBased.push(tribeId)
  }
  for (const tribeId of scoreBased) add(tribeId)
  return immune.slice(0, limit)
}

export interface PickAttendingTribeInput {
  totals: ReadonlyMap<string, number>
  tribeIds: readonly string[]
  immuneTribeIds: readonly string[]
}

/**
 * The lowest-scoring tribe that is not immune attends. Tribes with no counted score this week
 * come after every scored tribe, by id, so a tribe that genuinely scored lowest is never skipped
 * for one whose rows are missing.
 */
export function pickAttendingTribeId(input: PickAttendingTribeInput): string | null {
  const immune = new Set(input.immuneTribeIds)
  const candidates = [...new Set(input.tribeIds)].filter((tribeId) => !immune.has(tribeId))
  if (candidates.length === 0) return null
  const scored = candidates
    .filter((tribeId) => input.totals.has(tribeId))
    .sort((a, b) => input.totals.get(a)! - input.totals.get(b)! || a.localeCompare(b))
  if (scored.length) return scored[0]!
  return [...candidates].sort((a, b) => a.localeCompare(b))[0]!
}

export interface WeekImmunityResolution {
  immuneTribeIds: string[]
  attendingTribeId: string | null
  rewardTribeIds: string[]
  totals: Map<string, number>
}

export interface ResolveWeekImmunityOptions {
  settings?: SurvivorFoundationSettings
  /** Score rows for the week. Loaded (finalized, active managers only) when omitted. */
  scores?: readonly TribeScoreRow[]
  /** Active tribe ids. Loaded when omitted. */
  tribeIds?: readonly string[]
  scoreImmuneTribeId?: string | null
  db?: Db
}

/** Challenge-won tribe immunity for the week. Empty when the audit cannot be read. */
export async function loadRewardImmuneTribeIds(leagueId: string, week: number): Promise<string[]> {
  try {
    const state = await getWeeklyEffectState(leagueId, week)
    return [...state.immuneTribeIds].sort()
  } catch {
    return []
  }
}

export async function resolveWeekImmuneTribeIds(
  leagueId: string,
  week: number,
  opts: ResolveWeekImmunityOptions = {},
): Promise<WeekImmunityResolution> {
  const db = opts.db ?? prisma
  let settings = opts.settings
  if (!settings) {
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    settings = normalizeSurvivorFoundationSettings(
      league?.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {},
    )
  }
  const tribeIds =
    opts.tribeIds ?? (await db.survivorTribe.findMany({ where: { leagueId, isActive: true }, select: { id: true } })).map((tribe) => tribe.id)
  let scores = opts.scores
  if (!scores) {
    const active = await db.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true } })
    scores = await db.survivorWeeklyScore.findMany({
      where: { leagueId, week, isFinalized: true, countedTowardTribeTotal: true, tribeId: { not: null }, userId: { in: active.map((player) => player.userId) } },
      select: { tribeId: true, finalScore: true, countedTowardTribeTotal: true },
    })
  }
  const totals = tribeTotals(scores)
  const rewardTribeIds = await loadRewardImmuneTribeIds(leagueId, week)
  const immuneTribeIds = pickImmuneTribeIds({
    totals,
    tribeIds,
    twoHighest: settings.twoHighestTribesImmune,
    rewardTribeIds,
    scoreImmuneTribeId: opts.scoreImmuneTribeId ?? null,
  })
  return { immuneTribeIds, attendingTribeId: pickAttendingTribeId({ totals, tribeIds, immuneTribeIds }), rewardTribeIds, totals }
}
