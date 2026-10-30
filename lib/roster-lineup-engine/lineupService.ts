import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
/**
 * Persist lineup changes with validation, normalized sync, history, and optional lock cache.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { taxiPlayerIds, validateCanonicalRosterPayload } from './rosterValidationService'
import { loadKnownYearsExp } from './playerYearsExp'
import { syncAfRosterLineupAssignments } from './lineupAssignmentSync'
import { syncRedraftSlotTypesForLineup } from './redraftSlotSync'
import { isDailyLineupScoringEnabled, writeDailyLineupForSave } from '@/lib/redraft/dailyLineups'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { hashPlayerDataSnapshot, recordAfRosterMoveHistory } from './rosterMoveHistory'
import { lineupLayout, type AutomaticChangeUndo } from '@/lib/lineup-automation/automaticChangeUndo'
import { upsertAfLineupLockState, resolveFullLineupLockContext } from './lineupLockService'
import type { LineupValidationContext } from './types'
import { isCommissionerRosterLocked } from '@/lib/league/commissioner-roster-lock'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { starterSlotIndexOf } from '@/lib/league/lineupSlotPositions'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { checkTaxiSave, logTaxiPromotions, type TaxiSaveCheck } from '@/lib/taxi/taxiRulesService'
import { checkCampusSave } from '@/lib/c2c/campusLineupCheck'

/**
 * Locked starters keep their exact slot; a locked bench/IR player stays in that section.
 *
 * A starter's slot is his saved slot position (`slotIndex`, lib/league/lineupSlotPositions.ts) when
 * BOTH lineups carry one — so emptying a slot above him no longer reads as moving him, and moving
 * him into a different slot is caught. Otherwise (a lineup saved before positions, or by a writer
 * that sends none) it is his index in the compacted list, as before.
 */
export function movedLockedLineupPlayer(before: unknown, after: unknown, lockedPlayerIds: readonly string[]): string | null {
  if (lockedPlayerIds.length === 0) return null
  type Spot = { section: RosterSectionKey; compact: number; slot: number | null }
  const locations = (data: unknown) => {
    const sections = getNormalizedLineupSections(data)
    const result = new Map<string, Spot>()
    for (const section of Object.keys(sections) as RosterSectionKey[]) {
      sections[section].forEach((row, index) => {
        result.set(String(row.id), { section, compact: index, slot: section === 'starters' ? starterSlotIndexOf(row) : null })
      })
    }
    return result
  }
  const original = locations(before)
  const proposed = locations(after)
  const moved = (a: Spot | undefined, b: Spot | undefined) => {
    if (!a || !b) return a !== b
    if (a.section !== b.section) return true
    if (a.section !== 'starters') return false
    return a.slot != null && b.slot != null ? a.slot !== b.slot : a.compact !== b.compact
  }
  return lockedPlayerIds.find((id) => moved(original.get(id), proposed.get(id))) ?? null
}

/** Player ids in a lineup payload: one section's, or every section's. */
function lineupPlayerIds(data: unknown, only?: RosterSectionKey): string[] {
  const sections = getNormalizedLineupSections(data)
  const keys = only ? [only] : (Object.keys(sections) as RosterSectionKey[])
  return keys.flatMap((k) => sections[k].map((row) => String(row.id ?? '').trim())).filter(Boolean)
}

/** A player's name from either lineup, for a refusal the manager can read. */
function lineupPlayerNames(...payloads: unknown[]): (playerId: string) => string {
  const names = new Map<string, string>()
  for (const data of payloads) {
    const sections = getNormalizedLineupSections(data)
    for (const k of Object.keys(sections) as RosterSectionKey[]) {
      for (const row of sections[k]) {
        const o = row as Record<string, unknown>
        const name = String(o.name ?? o.playerName ?? '').trim()
        if (name) names.set(String(o.id ?? '').trim(), name)
      }
    }
  }
  return (id) => names.get(id) ?? `Player ${id}`
}

/** The per-slot check is extra safety: a layout that cannot be resolved skips it, never fails the save. */
function lineupStarterSlotsOrUndefined(...args: Parameters<typeof resolveLineupStarterSlots>) {
  try {
    return resolveLineupStarterSlots(...args)
  } catch {
    return undefined
  }
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
  /** Taxi players this save promotes to answer a steal claim (lib/taxi/taxiStealing.ts). */
  taxiProtection?: readonly string[]
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
      // The move lock binds members, not the commissioner correcting a roster under it — the same
      // exemption the trade and waiver runtimes give `commissionerOverride`. `skipLockCheck` alone did
      // not reach this validation, so the override tool was refused by the lock it exists to work around.
      lockAllMoves: input.source === 'commissioner_override' ? false : league.lockAllMoves,
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
    // The layout the lineup screen indexes (GET /api/league/roster), for per-slot checks.
    starterSlots: lineupStarterSlotsOrUndefined(
      {
        sport,
        leagueType: league.leagueType,
        isDynasty: league.isDynasty,
        leagueVariant: league.leagueVariant,
        bestBallMode: league.bestBallMode,
        guillotineMode: league.guillotineMode,
        keeperPhaseActive: league.keeperPhaseActive,
        settings: league.settings,
      },
      template,
    ),
    previousPlayerData: roster.playerData,
    taxiYearsExpById: await loadNewTaxiYearsExp(league, roster.playerData, input.nextPlayerData),
  }

  const validation = validateCanonicalRosterPayload(input.nextPlayerData, ctx)
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.issues.map((i) => i.message).join(' '),
      status: 400,
    }
  }

  // The taxi move rules the commissioner switched on (lib/taxi/taxiMoveRules.ts). Native only; a
  // commissioner override or an import is never refused.
  const taxiRosterId = resolveWriteAuthority(league.platform) === 'NATIVE' ? (roster.redraftRosterId ?? null) : null
  let taxiCheck: TaxiSaveCheck | null = null
  if (taxiRosterId && (input.source === 'user_save' || input.source === 'system')) {
    taxiCheck = await checkTaxiSave({
      leagueId: input.leagueId,
      redraftRosterId: taxiRosterId,
      week: input.week,
      beforeTaxi: lineupPlayerIds(roster.playerData, 'taxi'),
      afterTaxi: lineupPlayerIds(input.nextPlayerData, 'taxi'),
      afterRoster: lineupPlayerIds(input.nextPlayerData),
      nameOf: lineupPlayerNames(roster.playerData, input.nextPlayerData),
      protectedPromotions: input.taxiProtection,
    })
    if (taxiCheck.issues.length) return { ok: false, error: taxiCheck.issues.map((i) => i.message).join(' '), status: 400 }
  }

  // The C2C campus lineup (lib/c2c/campusLineup.ts). A commissioner override or an import is never refused.
  if (input.source === 'user_save' || input.source === 'system') {
    const campusIssues = await checkCampusSave(prisma, {
      league,
      redraftRosterId: roster.redraftRosterId ?? null,
      before: roster.playerData,
      after: input.nextPlayerData,
    })
    if (campusIssues.length) return { ok: false, error: campusIssues.map((i) => i.message).join(' '), status: 400 }
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
    if(input.automationAudit) {
      // Where every player sat before this automatic save, so the owner or commissioner can undo it
      // (lib/lineup-automation/automaticChangeUndo.ts). Placement only, never player details. The
      // fingerprint is of the lineup as the database will return it (JSON drops undefined fields).
      const undo: AutomaticChangeUndo = { layout: lineupLayout(before), afterHash: hashPlayerDataSnapshot(JSON.parse(JSON.stringify(input.nextPlayerData))), season: input.season, week: input.week }
      await tx.automationAuditLog.create({data:{...input.automationAudit, leagueId:input.leagueId,userId:input.actorUserId,entityType:"roster",entityId:input.rosterId,metadata:{...input.automationAudit.metadata, undo} as unknown as Prisma.InputJsonValue}})
    }
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
      const dailyLineups = isDailyLineupScoringEnabled(league.settings, sport)
      // The slots this save replaces back-fill the week's earlier days that have no saved lineup yet.
      const before = dailyLineups
        ? new Map(
            (
              await tx.redraftRosterPlayer.findMany({
                where: { rosterId: redraftRosterId, droppedAt: null },
                select: { playerId: true, slotType: true },
              })
            ).map((p) => [p.playerId, p.slotType] as const),
          )
        : undefined
      await syncRedraftSlotTypesForLineup(tx, { redraftRosterId, playerData: input.nextPlayerData })
      if (taxiCheck) await logTaxiPromotions(tx, { leagueId: input.leagueId, redraftRosterId, week: input.week, actorUserId: input.actorUserId, check: taxiCheck })
      // A daily-lineup league is scored per day: pin the synced slots to every day the save decides.
      if (dailyLineups) {
        await writeDailyLineupForSave(tx, {
          before,
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

  /*
   * The owner set a lineup of their own: if AllFantasy was setting it while they were away
   * (lib/inactive-manager), they are back and it stops. Only the OWNER's save — AllFantasy's own system
   * save and a commissioner override never end it. Read from the league already loaded, so an ordinary
   * save pays nothing; and best-effort, because the owner's save has already succeeded.
   */
  if (input.source === 'user_save' && roster.platformUserId && input.actorUserId === roster.platformUserId && readManagedLineups(league.settings)[input.rosterId]) {
    try {
      const { endInactiveManagerModeOnOwnerSave } = await import('@/lib/inactive-manager/inactiveManagerService')
      await endInactiveManagerModeOnOwnerSave(input.leagueId, input.rosterId, input.actorUserId)
    } catch (e) {
      console.warn('[lineup] could not end inactive manager mode after the owner saved', e instanceof Error ? e.message : e)
    }
  }

  return { ok: true }
}

/**
 * Experience on file for players this save moves onto the taxi squad, when the league has a rule it
 * can be judged against. Skipped entirely (no query) for the common save that leaves taxi alone.
 */
async function loadNewTaxiYearsExp(
  league: { sport: unknown; taxiSlots: number | null; taxiAllowNonRookies: boolean | null; taxiYearsLimit: number | null },
  previous: unknown,
  next: unknown,
): Promise<Map<string, number> | undefined> {
  if ((league.taxiSlots ?? 0) <= 0) return undefined
  if (league.taxiAllowNonRookies === true && !((league.taxiYearsLimit ?? 0) > 0)) return undefined
  const already = new Set(taxiPlayerIds(previous))
  const added = [...new Set(taxiPlayerIds(next).filter((id) => !already.has(id)))]
  if (added.length === 0) return undefined
  return loadKnownYearsExp([String(league.sport ?? 'NFL')], added)
}
