import { prisma } from '@/lib/prisma'
import {
  computeDraftRecommendation,
  resolveVorpMode,
  type RecommendationInput,
  type RecommendationPlayer,
  type VorpMode,
} from '@/lib/draft-helper/RecommendationEngine'

/**
 * Draft recommendation recorder (2026-11-14) — the FORWARD test for replacement value.
 *
 * The 2026-11-14 backtest replayed 28 real drafts and could not judge replacement value: every
 * FantasyProjection row had been rewritten after its draft (the table is upserted in place), so
 * nothing recorded what the projections said on draft day. This records it at the moment advice is
 * served — the recommendation in BOTH modes (`observe`, which ignores projections, and `active`,
 * which scores replacement value), and the projections each one saw — so that once the weeks are
 * played, `scripts/draft-backtest.ts --recorded` can score the two against what the players did.
 *
 * Background only, in the OS sense: nothing here changes what the user is shown, and it never
 * throws or delays a response. Rules:
 *   - Records ONLY when the pool carries projections. Without them the two modes are identical
 *     (measured: 3,349 of 3,349 real picks), so a row would carry no information.
 *   - One row per pick moment per surface (`dedupeKey`); the decision card is re-fetched while a
 *     manager waits, and the first read of a moment is the one that counts.
 *   - A missing table (the migration not yet applied) means "not recording yet": warned once,
 *     then skipped for the life of the process.
 *   - `DRAFT_RECOMMENDATION_RECORDER=off` turns it off.
 */

export const DRAFT_RECORDER_ENGINE_VERSION = 'draft-engine/2026-11-14'

/**
 * `autopick` (2026-11-22): a pick the clock made for a team (Draft like me, the queue, best available).
 * Unlike the two advice surfaces it stores the player ACTUALLY PICKED — in both observe and active, with
 * `servedMode` active — so the ledger grades what was drafted, not what the engine would have said. The
 * draft card's confidence never reads these rows (`gradeDraftTips` excludes the surface); they are graded
 * on their own, per strategy (`gradeAutopicks`).
 */
export const AUTOPICK_SURFACE = 'autopick' as const
export type RecordSurface = 'decision_card' | 'chimmy' | typeof AUTOPICK_SURFACE
export const AUTOPICK_RECORDER_ENGINE_VERSION = 'autopick/2026-11-22'
/** Fewer projected alternatives than this and the pick could not be graded anyway. */
export const AUTOPICK_MIN_PROJECTIONS = 5

export type RecordArgs = {
  surface: RecordSurface
  sport: string
  leagueId: string | null
  /** The draft's own key — a DraftSession id, or the draft room's session key. */
  sessionKey: string
  /** Whoever the advice was for — a roster id or a user id; only equality matters. */
  rosterKey: string
  overallPick: number
  round: number
  input: RecommendationInput
}

type Picked = { name: string; position: string; team: string | null; adp: number | null; projectedPoints: number | null } | null

export type RecommendationRecordRow = {
  dedupeKey: string
  surface: RecordSurface
  sport: string
  leagueId: string | null
  sessionKey: string
  rosterKey: string
  overallPick: number
  round: number
  servedMode: VorpMode
  observeName: string | null
  observePosition: string | null
  activeName: string | null
  activePosition: string | null
  agree: boolean
  projectionCount: number
  poolSize: number
  detail: { observe: Picked; active: Picked; projections: Record<string, number> }
  engineVersion: string
}

function projectionOf(p: RecommendationPlayer): number | null {
  return typeof p.projectedPoints === 'number' && Number.isFinite(p.projectedPoints) && p.projectedPoints > 0 ? p.projectedPoints : null
}

function picked(p: RecommendationPlayer | undefined): Picked {
  if (!p) return null
  return { name: p.name, position: p.position, team: p.team ?? null, adp: typeof p.adp === 'number' ? p.adp : null, projectedPoints: projectionOf(p) }
}

export function recordDedupeKey(args: Pick<RecordArgs, 'surface' | 'sessionKey' | 'rosterKey' | 'overallPick'>): string {
  return `${args.surface}:${args.sessionKey}:${args.rosterKey}:${args.overallPick}`.slice(0, 191)
}

/**
 * PURE. The row to write, or null when it would carry nothing (no projections in the pool, or no
 * recommendation in either mode). `projections` keeps every projected player's line — the
 * point-in-time snapshot that cannot be rebuilt later.
 */
export function buildRecommendationRecord(args: RecordArgs, env: NodeJS.ProcessEnv = process.env): RecommendationRecordRow | null {
  const projections: Record<string, number> = {}
  for (const p of args.input.available) {
    const pts = projectionOf(p)
    if (pts != null) projections[`${p.name}|${p.position}`] = pts
  }
  const projectionCount = Object.keys(projections).length
  if (projectionCount === 0) return null

  const run = (vorpMode: VorpMode) => computeDraftRecommendation({ ...args.input, vorpMode }).recommendation?.player
  const observe = run('observe')
  const active = run('active')
  if (!observe && !active) return null

  return {
    dedupeKey: recordDedupeKey(args),
    surface: args.surface,
    sport: args.sport.toUpperCase(),
    leagueId: args.leagueId,
    sessionKey: args.sessionKey.slice(0, 191),
    rosterKey: args.rosterKey.slice(0, 191),
    overallPick: args.overallPick,
    round: args.round,
    servedMode: resolveVorpMode(undefined, env),
    observeName: observe?.name ?? null,
    observePosition: observe?.position ?? null,
    activeName: active?.name ?? null,
    activePosition: active?.position ?? null,
    agree: (observe?.name ?? null) === (active?.name ?? null) && (observe?.position ?? null) === (active?.position ?? null),
    projectionCount,
    poolSize: args.input.available.length,
    detail: { observe: picked(observe), active: picked(active), projections },
    engineVersion: DRAFT_RECORDER_ENGINE_VERSION,
  }
}

let tableMissing = false

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'P2021' || /draft_recommendation_records.*does not exist/i.test(error instanceof Error ? error.message : '')
}

export type RecordOutcome = 'recorded' | 'duplicate' | 'nothing_to_record' | 'disabled' | 'not_recording_yet' | 'failed'

export async function recordDraftRecommendation(args: RecordArgs, env: NodeJS.ProcessEnv = process.env): Promise<RecordOutcome> {
  if (String(env['DRAFT_RECOMMENDATION_RECORDER'] ?? '').trim().toLowerCase() === 'off') return 'disabled'
  if (tableMissing) return 'not_recording_yet'
  try {
    const row = buildRecommendationRecord(args, env)
    if (!row) return 'nothing_to_record'
    const { count } = await prisma.draftRecommendationRecord.createMany({ data: [row], skipDuplicates: true })
    return count > 0 ? 'recorded' : 'duplicate'
  } catch (error) {
    if (isMissingTable(error)) {
      tableMissing = true
      console.warn('[draft-recorder] draft_recommendation_records does not exist yet — not recording until the migration is applied')
      return 'not_recording_yet'
    }
    console.warn('[draft-recorder] record failed', error instanceof Error ? error.message : error)
    return 'failed'
  }
}

export type AutopickRecordArgs = {
  sport: string
  leagueId: string
  sessionKey: string
  rosterKey: string
  overallPick: number
  round: number
  picked: { name: string; position: string; team: string | null; adp: number | null }
  /** `draft-as-me`, `queue`, `bpa`, `need-based`… — graded separately. */
  strategy: string
  reason: string
  /** The pool's season projections at the moment, `name|position` → points (names as the pool spells them). */
  projections: ReadonlyMap<string, number> | Readonly<Record<string, number>>
  poolSize: number
}

/** PURE. The auto-pick's row, or null when there are too few projections to ever grade it. */
export function buildAutopickRecord(args: AutopickRecordArgs): RecommendationRecordRow | null {
  const projections: Record<string, number> = {}
  const entries = args.projections instanceof Map ? [...args.projections.entries()] : Object.entries(args.projections)
  for (const [k, v] of entries) if (typeof v === 'number' && Number.isFinite(v) && v > 0) projections[k] = v
  const projectionCount = Object.keys(projections).length
  if (projectionCount < AUTOPICK_MIN_PROJECTIONS || !args.picked.name.trim()) return null
  const key = `${args.picked.name}|${args.picked.position}`
  const picked: Picked = {
    name: args.picked.name,
    position: args.picked.position,
    team: args.picked.team,
    adp: args.picked.adp,
    projectedPoints: projections[key] ?? null,
  }
  return {
    dedupeKey: recordDedupeKey({ surface: AUTOPICK_SURFACE, sessionKey: args.sessionKey, rosterKey: args.rosterKey, overallPick: args.overallPick }),
    surface: AUTOPICK_SURFACE,
    sport: args.sport.toUpperCase(),
    leagueId: args.leagueId,
    sessionKey: args.sessionKey.slice(0, 191),
    rosterKey: args.rosterKey.slice(0, 191),
    overallPick: args.overallPick,
    round: args.round,
    servedMode: 'active',
    observeName: args.picked.name,
    observePosition: args.picked.position,
    activeName: args.picked.name,
    activePosition: args.picked.position,
    agree: true,
    projectionCount,
    poolSize: args.poolSize,
    detail: { observe: picked, active: picked, projections, autopick: { strategy: args.strategy, reason: args.reason.slice(0, 500) } } as RecommendationRecordRow['detail'],
    engineVersion: AUTOPICK_RECORDER_ENGINE_VERSION,
  }
}

/** Same switches and table as the advice recorder; never throws. */
export async function recordAutopickDecision(args: AutopickRecordArgs, env: NodeJS.ProcessEnv = process.env): Promise<RecordOutcome> {
  if (String(env['DRAFT_RECOMMENDATION_RECORDER'] ?? '').trim().toLowerCase() === 'off') return 'disabled'
  if (tableMissing) return 'not_recording_yet'
  try {
    const row = buildAutopickRecord(args)
    if (!row) return 'nothing_to_record'
    const { count } = await prisma.draftRecommendationRecord.createMany({ data: [row], skipDuplicates: true })
    return count > 0 ? 'recorded' : 'duplicate'
  } catch (error) {
    if (isMissingTable(error)) {
      tableMissing = true
      return 'not_recording_yet'
    }
    console.warn('[draft-recorder] autopick record failed', error instanceof Error ? error.message : error)
    return 'failed'
  }
}

/** Fire and forget: never awaited by a request, never throws into one. */
export function scheduleDraftRecommendationRecord(args: RecordArgs): void {
  void recordDraftRecommendation(args).catch(() => undefined)
}

/** Test hook: forget a remembered missing table. */
export function __resetRecorderForTests(): void {
  tableMissing = false
}
