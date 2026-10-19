import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
/**
 * Persist lineup changes with validation, normalized sync, history, and optional lock cache.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { validateCanonicalRosterPayload } from './rosterValidationService'
import { syncAfRosterLineupAssignments } from './lineupAssignmentSync'
import { syncRedraftSlotTypesForLineup } from './redraftSlotSync'
import { isDailyLineupScoringEnabled, writeDailyLineupForSave } from '@/lib/redraft/dailyLineups'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { recordAfRosterMoveHistory } from './rosterMoveHistory'
import { upsertAfLineupLockState, resolveFullLineupLockContext } from './lineupLockService'
import type { LineupValidationContext } from './types'
import { isCommissionerRosterLocked } from '@/lib/league/commissioner-roster-lock'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'

/** Locked starters keep their exact slot; a locked bench/IR player stays in that section. */
export function movedLockedLineupPlayer(before: unknown, after: unknown, lockedPlayerIds: readonly string[]): string | null {
  if (lockedPlayerIds.length === 0) return null
  const locations = (data: unknown) => {
    const sections = getNormalizedLineupSections(data)
    const result = new Map<string, string>()
    for (const section of Object.keys(sections) as RosterSectionKey[]) {
      sections[section].forEach((row, index) => {
        result.set(String(row.id), section === 'starters' ? `${section}:${index}` : section)
      })
    }
    return result
  }
  const original = locations(before)
  const proposed = locations(after)
  return lockedPlayerIds.find((id) => original.get(id) !== proposed.get(id)) ?? null
}

function weekFromLeagueSettings(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 1
  const o = settings as Record<string, unknown>
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return Math.max(1, w)
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? Math.max(1, n) : 1
  }
  return 1
}

export type PersistRosterLineupInput = {
  leagueId: string
  rosterId: string
  actorUserId: string
  nextPlayerData: Record<string, unknown>
  season: number
  week: number
  source: 'user_save' | 'commissioner_override' | 'import' | 'system'
  skipLockCheck?: boolean
  transactionCheck?: (tx: Prisma.TransactionClient) => Promise<void>
  automationAudit?: { id: string; action: string; message: string; metadata: Record<string,unknown> }
  expectedOwnerUserId?: string
  expectedStarters?: string[]
}

function canonicalLineupEventTypeForSource(source: PersistRosterLineupInput['source']): string {
  if (source === 'commissioner_override') return 'commissioner.override'
  if (source === 'import') return 'roster.updated'
  if (source === 'system') return 'lineup.updated'
  return 'lineup.submitted'
}

export async function persistRosterLineupWithEngine(
  input: PersistRosterLineupInput,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
  })
  if (!league) return { ok: false, error: 'League not found', status: 404 }
  if (seasonSetupBlocked(league.settings)) return { ok: false, error: 'Tournament lineups remain locked until season activation.', status: 409 }

  const roster = await prisma.roster.findFirst({
    where: { id: input.rosterId, leagueId: input.leagueId },
  })
  if (!roster) return { ok: false, error: 'Roster not found', status: 404 }
  if (input.expectedStarters) {
    const current=(roster.playerData as Record<string,unknown> | null)?.starters
    if (!Array.isArray(current) || JSON.stringify(current.map(String))!==JSON.stringify(input.expectedStarters)) return {ok:false,error:'Your lineup changed. Refresh and compare again.',status:409}
  }

  if ((input.source === 'user_save' || input.source === 'system') && await isCommissionerRosterLocked(input.leagueId, input.rosterId)) {
    return { ok: false, error: 'This roster is locked by the commissioner.', status: 403 }
  }

  const sport = String(league.sport ?? 'NFL')
  const formatType = getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined)

  let template
  try {
    template = await getRosterTemplateForLeague(sport as never, formatType, input.leagueId)
  } catch {
    return { ok: false, error: 'Could not resolve roster template for this league.', status: 400 }
  }

  const ctx: LineupValidationContext = {
    league: {
      id: league.id,
      sport: league.sport,
      leagueVariant: league.leagueVariant,
      settings: league.settings,
      lifecycleState: league.lifecycleState,
      lockAllMoves: league.lockAllMoves,
      irAllowOut: league.irAllowOut,
      irAllowCovid: league.irAllowCovid,
      irAllowSuspended: league.irAllowSuspended,
      irAllowNA: league.irAllowNA,
      irAllowDNR: league.irAllowDNR,
      irAllowDoubtful: league.irAllowDoubtful,
      taxiSlots: league.taxiSlots,
      taxiAllowNonRookies: league.taxiAllowNonRookies,
      taxiYearsLimit: league.taxiYearsLimit,
      guillotineMode: league.guillotineMode,
      bestBallMode: league.bestBallMode,
    },
    template,
    season: input.season,
    week: input.week,
  }

  const validation = validateCanonicalRosterPayload(input.nextPlayerData, ctx)
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.issues.map((i) => i.message).join(' '),
      status: 400,
    }
  }

  const leagueWeek = weekFromLeagueSettings(league.settings)

  if (!input.skipLockCheck) {
    const lockCtx = await resolveFullLineupLockContext({
      leagueId: input.leagueId,
      rosterId: input.rosterId,
      sport,
      leagueVariant: league.leagueVariant,
      settings: league.settings,
      leagueWeek,
      editingWeek: input.week,
      season: input.season,
      // A client can edit nextPlayerData, including gameTime. Lock from the saved roster only.
      playerData: roster.playerData,
      lockAllMoves: league.lockAllMoves,
      lifecycleState: league.lifecycleState,
    })
    if (lockCtx.locked) {
      return {
        ok: false,
        error: lockCtx.reason ?? 'Lineup is locked.',
        status: 403,
      }
    }
    const movedLockedPlayer = movedLockedLineupPlayer(roster.playerData, input.nextPlayerData, lockCtx.lockedPlayerIds)
    if (movedLockedPlayer) {
      return { ok: false, error: 'That player\'s game has started, so their lineup position is locked.', status: 403 }
    }
  }

  const before = roster.playerData as Prisma.InputJsonValue

  /*
   * 🛑 NATIVE SCORING READS `RedraftRosterPlayer.slotType`, NOT THIS LINEUP. Without the sync below
   * a native manager could bench a ruled-out starter, see "Lineup saved", and still be scored on
   * him — live and at the week's seal. NATIVE only: an imported league is a SHADOW twin
   * (lib/league/write-authority.ts) and must never reach redraft tables. A roster with no linked
   * `RedraftRoster` has no scoring projection to keep.
   */
  const redraftRosterId =
    resolveWriteAuthority(league.platform) === 'NATIVE' ? (roster.redraftRosterId ?? null) : null

  try { await prisma.$transaction(async (tx) => {
    await input.transactionCheck?.(tx)
    if (input.expectedStarters) {
      const result=await tx.roster.updateMany({ where:{id:input.rosterId,...(input.expectedOwnerUserId?{platformUserId:input.expectedOwnerUserId}:{}),playerData:{equals:before}},data:{playerData:input.nextPlayerData as Prisma.InputJsonValue} })
      if(result.count!==1) throw new Error('STALE_TEAM_LINEUP')
    } else await tx.roster.update({
      where: { id: input.rosterId },
      data: { playerData: input.nextPlayerData as Prisma.InputJsonValue },
    })
    if(input.automationAudit) await tx.automationAuditLog.create({data:{...input.automationAudit, leagueId:input.leagueId,userId:input.actorUserId,entityType:"roster",entityId:input.rosterId,metadata:input.automationAudit.metadata as Prisma.InputJsonValue}})
    await syncAfRosterLineupAssignments(
      {
        leagueId: input.leagueId,
        rosterId: input.rosterId,
        season: input.season,
        week: input.week,
        playerData: input.nextPlayerData,
      },
      tx,
    )
    if (redraftRosterId) {
      await syncRedraftSlotTypesForLineup(tx, { redraftRosterId, playerData: input.nextPlayerData })
      // A daily-lineup league is scored per day: pin the synced slots to every day the save decides.
      if (isDailyLineupScoringEnabled(league.settings, sport)) {
        await writeDailyLineupForSave(tx, {
          leagueId: input.leagueId,
          redraftRosterId,
          sport,
          season: input.season,
          week: input.week,
          source: input.source === 'commissioner_override' ? 'commissioner' : input.source === 'user_save' ? 'user' : 'system',
        })
      }
    }
  }) } catch(e) {
    if(e instanceof Error && e.message==='STALE_TEAM_LINEUP') return {ok:false,error:'Your roster changed while saving. Refresh and compare again.',status:409}
    throw e
  }

  await recordAfRosterMoveHistory({
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    season: input.season,
    week: input.week,
    actorUserId: input.actorUserId,
    source: input.source,
    beforePlayerData: before,
    afterPlayerData: input.nextPlayerData,
    metadata: { week: input.week, season: input.season },
  })

  const lockCtx = await resolveFullLineupLockContext({
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    sport,
    leagueVariant: league.leagueVariant,
    settings: league.settings,
    leagueWeek,
    editingWeek: input.week,
    season: input.season,
    playerData: input.nextPlayerData,
    lockAllMoves: league.lockAllMoves,
    lifecycleState: league.lifecycleState,
  })

  await upsertAfLineupLockState({
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    season: input.season,
    week: input.week,
    globalLocked: lockCtx.locked,
    lockedPlayerIds: lockCtx.lockedPlayerIds,
    policy: lockCtx.policy,
    reason: lockCtx.reason ?? null,
    metadata: { perPlayerReasons: lockCtx.perPlayerReasons },
  })

  const eventType = canonicalLineupEventTypeForSource(input.source)
  void import('@/lib/league-events/publisher').then(({ publishLeagueFanoutEvent }) =>
    publishLeagueFanoutEvent({
      leagueId: input.leagueId,
      eventType,
      title: input.source === 'commissioner_override' ? 'Commissioner roster correction' : 'Lineup updated',
      message:
        input.source === 'commissioner_override'
          ? 'A commissioner applied a roster or lineup correction.'
          : 'A roster lineup was submitted and validated.',
      category: 'league_announcements',
      visibility: 'all_members',
      actorUserId: input.actorUserId,
      meta: {
        rosterId: input.rosterId,
        season: input.season,
        week: input.week,
        source: input.source,
        lockedPlayerIds: lockCtx.lockedPlayerIds,
      },
      dedupeKey: `lineup:${input.rosterId}:${input.season}-w${input.week}:${input.source}`,
      skipNotifications: true,
    }).catch(() => {}),
  ).catch(() => {})

  return { ok: true }
}
