/**
 * League lifecycle state machine: validates actions and safe transitions for canonical leagues.
 * Integrates with settings snapshots, engines, and commissioner overrides (see `commissionerService.ts`).
 */

import type { League, LeagueLifecycleState, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'

export type LeagueLifecycleAction =
  | 'draft_pick'
  | 'draft_commissioner_control'
  | 'draft_start'
  | 'waiver_claim_submit'
  | 'waiver_process_run'
  | 'scoring_process_week'
  | 'scoring_correction'
  | 'standings_view'
  | 'standings_manual_edit'
  | 'settings_edit_general'
  | 'settings_edit_scoring'
  | 'settings_edit_roster'
  | 'settings_edit_draft'
  | 'settings_edit_waivers'
  | 'settings_edit_trades'
  | 'settings_edit_playoffs'
  | 'settings_edit_commissioner'
  | 'settings_edit_concept_rules'
  | 'settings_edit_ai'
  | 'automation_run'
  | 'roster_edit'
  | 'trade_act'
  | 'import_sync'
  | 'league_archive'
  | 'league_lock_toggle'
  | 'renewal_initiate'
  | 'renewal_confirm'
  | 'renewal_execute'
  | 'succession_initiate'
  | 'legacy_view'

const TRANSITIONS: Record<LeagueLifecycleState, LeagueLifecycleState[]> = {
  setup: ['pre_draft', 'archived'],
  pre_draft: ['drafting', 'setup', 'archived'],
  drafting: ['post_draft', 'pre_draft', 'archived'],
  post_draft: ['in_season', 'drafting', 'archived'],
  in_season: ['playoffs', 'completed', 'drafting', 'archived'],
  playoffs: ['completed', 'in_season', 'archived'],
  completed: ['offseason', 'archived', 'in_season'],
  offseason: ['renewal_pending', 'setup', 'archived'],
  renewal_pending: ['setup', 'archived'],
  archived: [],
}

/** Actions allowed without commissioner override for each lifecycle phase. */
const ACTIONS: Record<LeagueLifecycleState, Set<LeagueLifecycleAction>> = {
  setup: new Set([
    'settings_edit_general',
    'settings_edit_scoring',
    'settings_edit_roster',
    'settings_edit_draft',
    'settings_edit_waivers',
    'settings_edit_trades',
    'settings_edit_playoffs',
    'settings_edit_commissioner',
    'settings_edit_concept_rules',
    'settings_edit_ai',
    'import_sync',
    'draft_commissioner_control',
    'league_archive',
    'league_lock_toggle',
  ]),
  pre_draft: new Set([
    'settings_edit_general',
    'settings_edit_scoring',
    'settings_edit_roster',
    'settings_edit_draft',
    'settings_edit_waivers',
    'settings_edit_trades',
    'settings_edit_playoffs',
    'settings_edit_commissioner',
    'settings_edit_concept_rules',
    'settings_edit_ai',
    'draft_start',
    'draft_commissioner_control',
    'import_sync',
    'league_archive',
    'league_lock_toggle',
  ]),
  drafting: new Set([
    'draft_pick',
    'draft_commissioner_control',
    'settings_edit_draft',
    'settings_edit_commissioner',
    'league_lock_toggle',
  ]),
  post_draft: new Set([
    'settings_edit_general',
    'settings_edit_draft',
    'settings_edit_commissioner',
    'settings_edit_waivers',
    'import_sync',
    'automation_run',
    'league_archive',
    'league_lock_toggle',
  ]),
  in_season: new Set([
    'waiver_claim_submit',
    'waiver_process_run',
    'scoring_process_week',
    'standings_view',
    'roster_edit',
    'trade_act',
    'settings_edit_general',
    'settings_edit_roster',
    'settings_edit_waivers',
    'settings_edit_trades',
    'settings_edit_playoffs',
    'settings_edit_commissioner',
    'settings_edit_ai',
    'automation_run',
    'import_sync',
    'scoring_correction',
    'standings_manual_edit',
    'league_lock_toggle',
    'league_archive',
  ]),
  playoffs: new Set([
    'waiver_claim_submit',
    'waiver_process_run',
    'scoring_process_week',
    'standings_view',
    'roster_edit',
    'trade_act',
    'settings_edit_general',
    'settings_edit_roster',
    'settings_edit_waivers',
    'settings_edit_trades',
    'settings_edit_playoffs',
    'settings_edit_commissioner',
    'settings_edit_ai',
    'automation_run',
    'scoring_correction',
    'standings_manual_edit',
    'league_lock_toggle',
    'league_archive',
  ]),
  completed: new Set([
    'standings_view',
    'settings_edit_commissioner',
    'league_archive',
    'league_lock_toggle',
    'legacy_view',
    'renewal_initiate',
  ]),
  offseason: new Set([
    'standings_view',
    'settings_edit_commissioner',
    'league_archive',
    'league_lock_toggle',
    'legacy_view',
    'renewal_initiate',
    'succession_initiate',
  ]),
  renewal_pending: new Set([
    'standings_view',
    'settings_edit_commissioner',
    'league_archive',
    'league_lock_toggle',
    'legacy_view',
    'renewal_confirm',
    'renewal_execute',
    'succession_initiate',
  ]),
  archived: new Set(['standings_view', 'legacy_view']),
}

export function normalizeLifecycleState(raw: string | null | undefined): LeagueLifecycleState {
  const s = String(raw || 'in_season') as LeagueLifecycleState
  if (s in TRANSITIONS) return s
  return 'in_season'
}

export function isOffseasonState(state: LeagueLifecycleState): boolean {
  return state === 'offseason' || state === 'renewal_pending' || state === 'completed'
}

export function isRenewalEligible(state: LeagueLifecycleState): boolean {
  return state === 'completed' || state === 'offseason'
}

export function getLeagueLifecycleState(league: Pick<League, 'lifecycleState'>): LeagueLifecycleState {
  return league.lifecycleState ?? 'in_season'
}

export function validateTransition(
  current: LeagueLifecycleState,
  next: LeagueLifecycleState,
): { ok: true } | { ok: false; reason: string } {
  if (current === next) {
    return { ok: false, reason: 'Already in requested state' }
  }
  const allowed = TRANSITIONS[current] ?? []
  if (!allowed.includes(next)) {
    return {
      ok: false,
      reason: `Cannot transition from ${current} to ${next}`,
    }
  }
  return { ok: true }
}

export function isActionAllowed(
  action: LeagueLifecycleAction,
  state: LeagueLifecycleState,
  opts?: { commissionerOverride?: boolean; roleIsElevated?: boolean },
): boolean {
  if (opts?.commissionerOverride && opts?.roleIsElevated) {
    return true
  }
  const set = ACTIONS[state]
  return Boolean(set?.has(action))
}

export function getAllowedActions(league: Pick<League, 'lifecycleState' | 'locked' | 'emergencyPaused'>): {
  state: LeagueLifecycleState
  actions: LeagueLifecycleAction[]
  locked: boolean
  emergencyPaused: boolean
} {
  const state = getLeagueLifecycleState(league)
  const list = [...(ACTIONS[state] ?? new Set())]
  return {
    state,
    actions: list,
    locked: league.locked ?? false,
    emergencyPaused: league.emergencyPaused ?? false,
  }
}

export type TransitionResult =
  | { ok: true; league: League }
  | { ok: false; error: string; code: 'INVALID' | 'FORBIDDEN' }

export async function transitionLeagueState(
  leagueId: string,
  nextState: LeagueLifecycleState,
  actorUserId: string,
  opts?: { force?: boolean; metadata?: Record<string, unknown> },
): Promise<TransitionResult> {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return { ok: false, error: 'League not found', code: 'FORBIDDEN' }

  const current = getLeagueLifecycleState(league)
  const check = opts?.force ? { ok: true as const } : validateTransition(current, nextState)
  if (!check.ok) {
    return { ok: false, error: check.reason, code: 'INVALID' }
  }

  const before = { lifecycleState: current }
  const updated = await prisma.league.update({
    where: { id: leagueId },
    data: {
      lifecycleState: nextState,
      lifecycleMetadata: {
        ...(typeof league.lifecycleMetadata === 'object' && league.lifecycleMetadata !== null
          ? (league.lifecycleMetadata as Record<string, unknown>)
          : {}),
        lastTransitionAt: new Date().toISOString(),
        lastTransitionFrom: current,
        ...(opts?.metadata ?? {}),
      } as import('@prisma/client').Prisma.InputJsonValue,
    },
  })

  await logAction({
    leagueId,
    userId: actorUserId,
    actionType: 'lifecycle_transition',
    entityType: 'league',
    entityId: leagueId,
    beforeState: before,
    afterState: { lifecycleState: nextState },
    metadata: { force: Boolean(opts?.force) },
  })

  void import('@/lib/league-events/publisher')
    .then(({ publishLeagueFanoutEvent }) =>
      publishLeagueFanoutEvent({
        leagueId,
        eventType: 'lifecycle_transition',
        title: 'League phase updated',
        message: `Your league is now in ${String(nextState).replace(/_/g, ' ')}.`,
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId,
        meta: { from: current, to: nextState, force: Boolean(opts?.force) },
        dedupeKey: `lifecycle:${leagueId}:${current}->${nextState}`,
      }),
    )
    .catch(() => {})

  return { ok: true, league: updated }
}

/**
 * When the draft session is live (in progress or paused) but the league row is still
 * `pre_draft` or `setup`, lifecycle gates block `draft_pick`. Sync league lifecycle so
 * picks and automation match an active draft (e.g. after `startDraftSession` without a
 * separate transition route).
 */
export async function ensureDraftingLifecycleForActiveSession(
  leagueId: string,
  actorUserId?: string | null,
): Promise<void> {
  try {
    const [league, draftSession] = await Promise.all([
      prisma.league.findUnique({
        where: { id: leagueId },
        select: { lifecycleState: true, userId: true },
      }),
      prisma.draftSession.findUnique({
        where: { leagueId },
        select: { status: true },
      }),
    ])
    if (!league || !draftSession) return

    const draftLive =
      draftSession.status === 'in_progress' || draftSession.status === 'paused'
    if (!draftLive) return

    const actor = (actorUserId && String(actorUserId).trim()) || league.userId || 'system'
    const state = getLeagueLifecycleState(league)

    if (state === 'drafting') return

    if (state === 'pre_draft') {
      const r = await transitionLeagueState(leagueId, 'drafting', actor)
      if (!r.ok) console.warn('[ensureDraftingLifecycleForActiveSession] pre_draft→drafting', r.error)
      return
    }

    if (state === 'setup') {
      const toPre = await transitionLeagueState(leagueId, 'pre_draft', actor)
      if (toPre.ok) {
        const toDraft = await transitionLeagueState(leagueId, 'drafting', actor)
        if (!toDraft.ok) console.warn('[ensureDraftingLifecycleForActiveSession] pre_draft→drafting', toDraft.error)
      } else {
        const forced = await transitionLeagueState(leagueId, 'drafting', actor, { force: true })
        if (!forced.ok) console.warn('[ensureDraftingLifecycleForActiveSession] setup fallback', forced.error)
      }
    }
  } catch (e) {
    console.warn('[ensureDraftingLifecycleForActiveSession] non-fatal', e)
  }
}

export async function loadLeagueForLifecycle(leagueId: string) {
  return prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      userId: true,
      lifecycleState: true,
      locked: true,
      emergencyPaused: true,
      lifecycleMetadata: true,
      status: true,
    },
  })
}

export type LifecycleGateError = { status: number; error: string; code: string }

export async function assertLifecycleActionAllowed(
  leagueId: string,
  action: LeagueLifecycleAction,
  userId: string,
  opts?: { commissionerOverride?: boolean; isElevatedCommissioner?: boolean },
): Promise<{ ok: true } | { ok: false; err: LifecycleGateError }> {
  const row = await loadLeagueForLifecycle(leagueId)
  if (!row) {
    return { ok: false, err: { status: 404, error: 'League not found', code: 'NOT_FOUND' } }
  }

  const state = getLeagueLifecycleState(row as Pick<League, 'lifecycleState'>)
  const elevated = Boolean(opts?.isElevatedCommissioner)

  if (row.emergencyPaused && !elevated && action !== 'standings_view') {
    return {
      ok: false,
      err: {
        status: 423,
        error: 'League is emergency-paused. Only commissioners can act.',
        code: 'EMERGENCY_PAUSE',
      },
    }
  }

  if (
    row.locked &&
    !elevated &&
    action !== 'standings_view' &&
    action !== 'settings_edit_commissioner'
  ) {
    return {
      ok: false,
      err: {
        status: 423,
        error: 'League is locked. Use commissioner tools or override.',
        code: 'LEAGUE_LOCKED',
      },
    }
  }

  const allowed = isActionAllowed(action, state, {
    commissionerOverride: opts?.commissionerOverride,
    roleIsElevated: elevated,
  })

  if (!allowed) {
    return {
      ok: false,
      err: {
        status: 400,
        error: `Action "${action}" is not allowed in lifecycle state "${state}"`,
        code: 'LIFECYCLE_BLOCKED',
      },
    }
  }

  return { ok: true }
}

// ── Draft completion ↔ lifecycle (dashboard Matchup tab) ─────────────────

function mergeLifecycleMetadata(
  existing: Prisma.JsonValue | null | undefined,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  return { ...base, ...patch } as Prisma.InputJsonValue
}

/**
 * When every pick is in, move the league to `post_draft` so `LeagueShell` promotes Matchup over Draft.
 * Uses a forced transition when the state machine does not allow setup/pre_draft → post_draft directly,
 * since a completed draft is authoritative.
 */
export function resolveLifecycleTransitionAfterDraftCompletes(
  current: LeagueLifecycleState,
): { target: LeagueLifecycleState; force: boolean } | null {
  if (
    current === 'post_draft' ||
    current === 'in_season' ||
    current === 'playoffs' ||
    current === 'completed' ||
    current === 'archived'
  ) {
    return null
  }

  const target: LeagueLifecycleState = 'post_draft'
  const check = validateTransition(current, target)
  if (check.ok) {
    return { target, force: false }
  }
  return { target, force: true }
}

export type ApplyPostDraftLifecycleResult = {
  applied: boolean
  from?: LeagueLifecycleState
  to?: LeagueLifecycleState
  commissionerUserId?: string
}

export type TransactionalLifecycleTransitionResult = {
  applied: boolean
  from: LeagueLifecycleState
  to: LeagueLifecycleState
}

/**
 * Generic validated lifecycle transition inside the caller's transaction. Reads
 * the current state, checks the transition is legal, and flips `lifecycleState`
 * atomically. Used by redraft offseason entry to move a completed league into
 * `offseason` in the same tx that writes the season snapshot. Mirrors the lean
 * style of applyPostDraftLifecycleInTransaction (no side-channel writes); callers
 * emit their own domain events around it.
 */
export async function transitionLeagueStateInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    leagueId: string
    nextState: LeagueLifecycleState
    actorUserId?: string | null
    source: string
    idempotencyKey: string
    metadata?: Record<string, unknown>
  },
): Promise<TransactionalLifecycleTransitionResult> {
  const league = await tx.league.findUnique({
    where: { id: input.leagueId },
    select: { lifecycleState: true, lifecycleMetadata: true },
  })
  if (!league) throw new Error('League not found')

  const current = getLeagueLifecycleState(league)
  if (current === input.nextState) {
    return { applied: false, from: current, to: current }
  }
  const allowed = validateTransition(current, input.nextState)
  if (!allowed.ok) throw new Error(allowed.reason)

  await tx.league.update({
    where: { id: input.leagueId },
    data: {
      lifecycleState: input.nextState,
      lifecycleMetadata: mergeLifecycleMetadata(league.lifecycleMetadata, {
        lastTransitionAt: new Date().toISOString(),
        lastTransitionFrom: current,
        transitionSource: input.source,
        transitionIdempotencyKey: input.idempotencyKey,
        ...(input.metadata ?? {}),
      }),
    },
  })

  return { applied: true, from: current, to: input.nextState }
}

/**
 * Idempotent: if the league is already post_draft or later, no update.
 * Call inside the same transaction that marks `DraftSession` completed.
 */
export async function applyPostDraftLifecycleInTransaction(
  tx: Prisma.TransactionClient,
  leagueId: string,
): Promise<ApplyPostDraftLifecycleResult> {
  const league = await tx.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, lifecycleState: true, lifecycleMetadata: true },
  })
  if (!league) {
    return { applied: false }
  }

  const current = getLeagueLifecycleState(league)
  const resolved = resolveLifecycleTransitionAfterDraftCompletes(current)
  if (!resolved) {
    return { applied: false, from: current, commissionerUserId: league.userId }
  }

  const { target } = resolved
  await tx.league.update({
    where: { id: leagueId },
    data: {
      lifecycleState: target,
      lifecycleMetadata: mergeLifecycleMetadata(league.lifecycleMetadata, {
        lastTransitionAt: new Date().toISOString(),
        lastTransitionFrom: current,
        draftCompletionAuto: true,
      }),
    },
  })

  return { applied: true, from: current, to: target, commissionerUserId: league.userId }
}

/**
 * When a commissioner resets an in-app draft after completion, move lifecycle back toward draft so
 * the Draft tab can lead again. Only downgrades from `post_draft` → `drafting` (valid transition).
 */
export function resolveLifecycleTransitionAfterDraftReset(
  current: LeagueLifecycleState,
): LeagueLifecycleState | null {
  if (current !== 'post_draft') return null
  const check = validateTransition(current, 'drafting')
  return check.ok ? 'drafting' : null
}

export async function applyDraftingLifecycleOnDraftResetInTransaction(
  tx: Prisma.TransactionClient,
  leagueId: string,
): Promise<ApplyPostDraftLifecycleResult> {
  const league = await tx.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, lifecycleState: true, lifecycleMetadata: true },
  })
  if (!league) {
    return { applied: false }
  }

  const current = getLeagueLifecycleState(league)
  const next = resolveLifecycleTransitionAfterDraftReset(current)
  if (!next) {
    return { applied: false, from: current, commissionerUserId: league.userId }
  }

  await tx.league.update({
    where: { id: leagueId },
    data: {
      lifecycleState: next,
      lifecycleMetadata: mergeLifecycleMetadata(league.lifecycleMetadata, {
        lastTransitionAt: new Date().toISOString(),
        lastTransitionFrom: current,
        draftResetAuto: true,
      }),
    },
  })

  return { applied: true, from: current, to: next, commissionerUserId: league.userId }
}
