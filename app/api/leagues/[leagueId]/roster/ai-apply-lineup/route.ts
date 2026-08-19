import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { validateAiActionExecution } from '@/lib/ai/action-validation'
import { isRosterChopped } from '@/lib/guillotine/guillotineGuard'
import { getSpecialtySpecByVariant } from '@/lib/specialty-league/registry'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import {
  buildPersistedRosterDataFromRosterState,
  weekFromLeagueSettingsForLineup,
} from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { evaluateLegalityForPersistedRoster } from '@/lib/roster-legality/loadLegalityEvaluationContext'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedLineupIntegrationService, extractPlayerRefs } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'

export const dynamic = 'force-dynamic'

/**
 * POST: same body shape as `/api/leagues/roster/save` (`week`, `roster` with starters/bench/ir/taxi/devy).
 * Requires `pro_autocoach` entitlement; rejects persisted save until full roster legality passes (stricter than persist alone).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { leagueId } = await params

  const body = await req.json().catch(() => ({}))
  const aiValidation = validateAiActionExecution({ body, action: 'apply_lineup', leagueId })
  if (!aiValidation.ok) return NextResponse.json({ error: aiValidation.error }, { status: aiValidation.status })

  const ent = await new EntitlementResolver().resolveForUser(userId, 'pro_autocoach')
  if (!ent.hasAccess) {
    return NextResponse.json(
      { error: ent.message || 'Premium AutoCoach / Start-Sit tier required.', code: 'ENTITLEMENT' },
      { status: 403 },
    )
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      userId: true,
      leagueVariant: true,
      sport: true,
      settings: true,
      season: true,
    },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true, playerData: true },
  })
  if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })

  const chopped = await isRosterChopped(leagueId, roster.id)
  if (chopped) {
    return NextResponse.json({ error: 'This team cannot change lineup in its current state.' }, { status: 403 })
  }

  const specialtySpec = getSpecialtySpecByVariant(league.leagueVariant ?? null)
  if (specialtySpec?.rosterGuard) {
    const canAct = await specialtySpec.rosterGuard(leagueId, roster.id).catch(() => true)
    if (!canAct) {
      return NextResponse.json({ error: 'Roster changes are not allowed right now.' }, { status: 403 })
    }
  }

  const rosterState = (body as Record<string, unknown>)?.roster
  if (!rosterState || typeof rosterState !== 'object' || Array.isArray(rosterState)) {
    return NextResponse.json({ error: 'roster object required (starters, bench, ir, taxi, devy).' }, { status: 400 })
  }

  const nextPlayerData = buildPersistedRosterDataFromRosterState(rosterState, roster.playerData) as Record<
    string,
    unknown
  >

  const legality = await evaluateLegalityForPersistedRoster({
    id: roster.id,
    leagueId,
    playerData: nextPlayerData,
  })
  if (!legality) return NextResponse.json({ error: 'Could not evaluate lineup legality.' }, { status: 400 })
  if (!legality.result.isLegal) {
    return NextResponse.json(
      {
        error: 'Proposed lineup is not legal for this league (slots, IR, taxi, devy, or locks).',
        code: 'ROSTER_ILLEGAL',
        rosterLegality: {
          blockingReasons: legality.result.blockingReasons,
          highlightedPlayerIds: legality.result.highlightedPlayerIds,
          isLineupLocked: legality.result.isLineupLocked,
        },
      },
      { status: 409 },
    )
  }

  const editingWeekRaw = (body as Record<string, unknown>)?.week
  const editingWeek =
    typeof editingWeekRaw === 'number' && Number.isFinite(editingWeekRaw)
      ? Math.max(1, Math.floor(editingWeekRaw))
      : weekFromLeagueSettingsForLineup(league.settings)

  const season = league.season ?? new Date().getFullYear()

  // Gated, reject-only certified sports safety check — runs AFTER the authoritative roster legality + lock
  // check above and BEFORE persistence. It can only ADD a rejection (never approve, never weaken the existing
  // decision), and only on TRUSTWORTHY (current) certified evidence that a started player's game is already
  // locked/final/postponed. On stale/unavailable certified data it does not block this human-confirmed manual
  // save (the engine's own lock check below, skipLockCheck:false, remains final). Evidence is EMITTED in the
  // response (not persisted to a new production table). Wrapped so it can never turn a safe save into an error.
  let sportsDataDecision:
    | { featureGateEnabled: boolean; finalDecision: 'allowed' | 'rejected'; reason: string; freshnessStatus: string; identityStatus: string; scheduleSnapshotVersion: string | null; blockedCanonicalPlayerIds: string[]; evaluatedAt: string }
    | undefined
  if (isSportsDataEnabled('lineup') && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
    try {
      const starters = extractPlayerRefs((rosterState as Record<string, unknown>).starters)
      const guard = await new CertifiedLineupIntegrationService().evaluateLineupPersistSafety({ season: String(season), week: String(editingWeek), starterRefs: starters })
      sportsDataDecision = {
        featureGateEnabled: true,
        finalDecision: guard.block ? 'rejected' : 'allowed',
        reason: guard.reason,
        freshnessStatus: guard.freshnessStatus,
        identityStatus: guard.identityStatus,
        scheduleSnapshotVersion: guard.snapshotVersion,
        blockedCanonicalPlayerIds: guard.blockedPlayers,
        evaluatedAt: new Date().toISOString(),
      }
      if (guard.block) {
        console.info('[lineup/ai-apply][sports-data] rejected', { leagueId, rosterId: roster.id, reason: guard.reason, snapshot: guard.snapshotVersion })
        return NextResponse.json({ error: `Lineup blocked by certified game evidence: ${guard.reason}`, code: 'SPORTS_DATA_LOCK', sportsDataDecision }, { status: 409 })
      }
    } catch {
      // Fail-open for a human-confirmed manual save: the engine's own lock check below remains authoritative.
      sportsDataDecision = { featureGateEnabled: true, finalDecision: 'allowed', reason: 'certified sports evidence unavailable — existing authority final', freshnessStatus: 'unavailable', identityStatus: 'unresolved', scheduleSnapshotVersion: null, blockedCanonicalPlayerIds: [], evaluatedAt: new Date().toISOString() }
    }
  }

  const persisted = await persistRosterLineupWithEngine({
    leagueId,
    rosterId: roster.id,
    actorUserId: userId,
    nextPlayerData,
    season,
    week: editingWeek,
    source: 'user_save',
    skipLockCheck: false,
  })

  if (!persisted.ok) {
    return NextResponse.json({ error: persisted.error }, { status: persisted.status ?? 400 })
  }

  return NextResponse.json({ ok: true, rosterId: roster.id, week: editingWeek, source: 'ai_apply_lineup', ...(sportsDataDecision ? { sportsDataDecision } : {}) })
}
