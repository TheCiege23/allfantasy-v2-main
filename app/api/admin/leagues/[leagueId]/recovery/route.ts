/**
 * Admin — league recovery.
 *   GET  /api/admin/leagues/[leagueId]/recovery   what is wrong, and what may legally be done
 *   POST /api/admin/leagues/[leagueId]/recovery   do one of those things
 *
 * Both carry the same gate. The GET is not a convenience: the POST validates transitions against a
 * table the caller cannot see, so without a read an operator picks from ten enum values and mostly
 * gets rejections. See the GET's own note below.
 *
 * 🛑 WHY THIS EXISTS: A PLATFORM OPERATOR COULD NOT RECOVER A LEAGUE THEY DO NOT BELONG TO.
 * Every league-scoped equivalent gates on membership first — `app/api/leagues/[leagueId]/
 * lifecycle/handler.ts` returns 403 on `!access?.isMember`, then again on `!elevated`, and
 * archive additionally requires the HEAD commissioner. None of them has an admin branch. So a
 * stuck lifecycle state, waivers that stopped processing, a hung draft, or a stat correction
 * needing a week reprocessed were all unfixable by support unless they happened to commission
 * that league.
 *
 * `lib/admin/recovery/adminRecoveryService.ts` was written for exactly this and had no caller —
 * built, complete, and unreachable. This is the door. It adds no capability of its own.
 *
 * ⚠ EVERY ACTION WRITES `AdminAuditLog`, AND THAT IS WHAT MAKES EXPOSING THIS DEFENSIBLE. An
 * operator mutating someone else's league is only acceptable if it is attributable. The service
 * does that logging itself; this route's job is to supply a real actor and refuse everything else.
 *
 * ⚠ THE ACTOR COMES FROM `resolveAdminAuditActor`, NOT `gate.user.id`. `AdminUser.id` is
 * OPTIONAL, `AdminAuditLog.adminUserId` is NOT NULL (`VarChar(64)`), and `logAdminAudit` swallows
 * its own insert failure in a `catch`. So passing a bare `user.id` would, on any admin session
 * that carries no id, perform the privileged mutation and silently write no audit row — the one
 * failure that would make this endpoint unsafe. `resolveAdminAuditActor` is the helper the six
 * other audit-writing admin routes already use and never returns empty.
 * ⚠ There WAS a second helper — `lib/admin/adminActor.ts`'s `getAdminActorId`, zero consumers,
 * with a different fallback (`'admin:unknown'`). It was deleted rather than left as a footgun; if
 * it reappears, `resolveAdminAuditActor` is still the one with consumers and a NAMED fallback.
 *
 * ⚠ `requireAdmin`, NOT `requireAdminOrBearer`. This mutates arbitrary leagues, so it is
 * deliberately session-only: the bearer/shared-secret path returns `{ role: 'admin' }` with no id
 * and no email, which is precisely the unattributable case above. See
 * `lib/adminAuth.ts` — the repo's two admin gates are not equivalent.
 *
 * ⚠ `nextState` is validated with `z.nativeEnum(LeagueLifecycleState)` rather than a hand-written
 * list, so it cannot drift from the schema. Enum-validity is not transition-validity: the service
 * still runs `validateTransition(current, next)` against the TRANSITIONS table underneath, and
 * `force: true` is what bypasses that — this route does not second-guess either.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { LeagueLifecycleState } from '@prisma/client'
import { requireAdmin } from '@/lib/adminAuth'
import { resolveAdminAuditActor } from '@/lib/admin-audit'
import { runAdminLeagueRecovery } from '@/lib/admin/recovery/adminRecoveryService'
import { buildLeagueInspectSnapshot } from '@/lib/admin/operations/leagueInspectService'
import { normalizeLifecycleState, validateTransition } from '@/server/services/leagueLifecycleService'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Audit actions this service writes, all tagged `targetType: 'league'`. */
const RECOVERY_AUDIT_ACTIONS = [
  'ops_lifecycle_repair',
  'ops_enqueue_waiver',
  'ops_enqueue_scoring',
  'ops_enqueue_automation',
  'ops_stat_reprocess',
  'ops_draft_pause',
] as const

/**
 * GET — what is wrong with this league, and what may legally be done about it.
 *
 * 🛑 THE POST IS UNUSABLE WITHOUT THIS. `transitionLeagueState` validates against a TRANSITIONS
 * table, so an operator choosing from all ten enum values would have most attempts bounce. This
 * returns the legal set for the league's ACTUAL state, so the caller picks from what will work.
 *
 * ⚠ THE ALLOWED SET IS DERIVED FROM `validateTransition`, NOT COPIED FROM THE TABLE. `TRANSITIONS`
 * is module-private in the lifecycle service; re-declaring it here would be a second copy that
 * drifts the first time someone edits the real one. Asking the exported validator about each enum
 * member costs ten calls and cannot disagree with the thing that actually enforces it.
 */
export async function GET(
  _request: Request,
  { params }: { params: { leagueId: string } },
) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const leagueId = params?.leagueId?.trim()
  if (!leagueId) {
    return NextResponse.json({ ok: false, error: 'leagueId is required' }, { status: 400 })
  }

  const snapshot = await buildLeagueInspectSnapshot(leagueId)
  if (!snapshot?.league) {
    return NextResponse.json({ ok: false, error: 'League not found' }, { status: 404 })
  }

  /**
   * ⚠ RAW AND NORMALIZED ARE BOTH REPORTED, AND THAT IS NOT REDUNDANCY.
   * `normalizeLifecycleState` silently returns `'in_season'` for anything it does not recognise —
   * including `null`. A screen showing only the normalized value would state, confidently, that a
   * league with no lifecycle state is in season, and offer that state's transitions. `coerced`
   * makes the substitution visible instead of letting it read as fact.
   */
  const raw = snapshot.league.lifecycleState
  const normalized = normalizeLifecycleState(raw)
  const coerced = raw !== normalized

  const allowedTransitions = Object.values(LeagueLifecycleState).filter(
    (candidate) => validateTransition(normalized, candidate).ok,
  )

  const recentActions = await prisma.adminAuditLog.findMany({
    where: { targetType: 'league', targetId: leagueId, action: { in: [...RECOVERY_AUDIT_ACTIONS] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, action: true, adminUserId: true, details: true, createdAt: true },
  })

  return NextResponse.json({
    ok: true,
    snapshot,
    lifecycle: { raw, normalized, coerced, allowedTransitions },
    recentActions,
  })
}

/**
 * Mirrors `AdminRecoveryAction`. The discriminated union is deliberate: an unknown `type` is
 * rejected here rather than falling through the service's switch to an unhandled default.
 */
const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('lifecycle_transition'),
    nextState: z.nativeEnum(LeagueLifecycleState),
    force: z.boolean().optional(),
  }),
  z.object({ type: z.literal('enqueue_waiver_process') }),
  z.object({
    type: z.literal('enqueue_scoring_week'),
    season: z.number().int(),
    weekOrRound: z.number().int(),
    lockScores: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('enqueue_specialty_automation'),
    season: z.number().int(),
    week: z.number().int().nullable().optional(),
    trigger: z.string().optional(),
  }),
  z.object({
    type: z.literal('stat_correction_sync'),
    season: z.number().int(),
    week: z.number().int(),
  }),
  // `confirm` is a literal `true`, not a boolean — sending `false` is a validation error rather
  // than a silently skipped pause. The service enforces the same thing; both are cheap.
  z.object({ type: z.literal('draft_pause'), confirm: z.literal(true) }),
])

export async function POST(
  request: Request,
  { params }: { params: { leagueId: string } },
) {
  // The gate runs FIRST and returns before anything is read, parsed, or dispatched.
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const leagueId = params?.leagueId?.trim()
  if (!leagueId) {
    return NextResponse.json({ ok: false, error: 'leagueId is required' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON' }, { status: 400 })
  }

  const parsed = ActionSchema.safeParse((body as { action?: unknown } | null)?.action)
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid action',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    )
  }

  const result = await runAdminLeagueRecovery({
    leagueId,
    adminUserId: resolveAdminAuditActor(gate.user),
    action: parsed.data,
  })

  if (!result.ok) {
    // The service's failure shape carries a message and no code, so every service-level refusal
    // is a 400 here rather than being sorted by matching on the message text — a string match on
    // an error message is a mapping that rots the first time the wording changes.
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true, detail: result.detail ?? null })
}
