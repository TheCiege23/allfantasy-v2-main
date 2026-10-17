import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { normalizeSurvivorFoundationSettings } from './survivorSettings'
import { buildSurvivorFullSeasonPlan, readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { loadNbaSurvivorRosterEligibility } from '@/lib/draft-room/nbaSurvivorRosterEligibility'

type DraftSeat = { id: string; platformUserId: string }

export type SurvivorDraftStartReadiness =
  | { ready: true }
  | { ready: false; error: string }

/**
 * The post-draft cast initializer requires one real, unique manager per drafted
 * roster. Check that invariant before the first pick, when fixing an open seat
 * is still possible without undoing a completed draft.
 */
export function evaluateSurvivorDraftCast(input: {
  teamCount: number
  slotOrder: unknown
  rosters: DraftSeat[]
  existingUserIds: string[]
  commissionerUserId: string
  commissionerPlays: boolean
}): SurvivorDraftStartReadiness {
  const { rosters, teamCount } = input
  const rosterIds = new Set(rosters.map((roster) => roster.id))
  const slots = Array.isArray(input.slotOrder) ? input.slotOrder : []
  const slotIds = slots.map((slot) => slot && typeof slot === 'object' && !Array.isArray(slot)
    ? String((slot as Record<string, unknown>).rosterId ?? '') : '')
  if (rosters.length !== teamCount || rosterIds.size !== teamCount ||
      slotIds.length !== teamCount || new Set(slotIds).size !== teamCount ||
      slotIds.some((id) => !rosterIds.has(id))) {
    return { ready: false, error: 'The Survivor draft must have exactly one roster in every cast seat. Repair the draft order before starting.' }
  }
  const owners = rosters.map((roster) => roster.platformUserId)
  const existing = new Set(input.existingUserIds)
  const unclaimed = owners.filter((id) => !id || id.startsWith('open-slot-') || !existing.has(id))
  if (unclaimed.length > 0) {
    return { ready: false, error: `Claim all ${unclaimed.length} open Survivor cast seat${unclaimed.length === 1 ? '' : 's'} before starting the draft.` }
  }
  if (new Set(owners).size !== teamCount) {
    return { ready: false, error: 'Each Survivor draft seat needs a different manager before the draft starts.' }
  }
  if (!input.commissionerPlays && owners.includes(input.commissionerUserId)) {
    return { ready: false, error: 'The commissioner is set to host only but still owns a Survivor team. Transfer that team or switch to playing commissioner before starting.' }
  }
  return { ready: true }
}

export async function getSurvivorDraftStartReadiness(
  leagueId: string,
  session: { teamCount: number; rounds: number; slotOrder: unknown },
): Promise<SurvivorDraftStartReadiness> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, sport: true, survivorMode: true, leagueVariant: true, userId: true, settings: true },
  })
  if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE' ||
      (!league.survivorMode && league.leagueVariant !== 'survivor')) return { ready: true }

  const rosters = await prisma.roster.findMany({
    where: { leagueId }, select: { id: true, platformUserId: true },
  })
  const ownerIds = [...new Set(rosters.map((roster) => roster.platformUserId)
    .filter((id) => id && !id.startsWith('open-slot-')))]
  const users = await prisma.appUser.findMany({
    where: { id: { in: ownerIds } }, select: { id: true },
  })
  const cast = evaluateSurvivorDraftCast({
    teamCount: session.teamCount,
    slotOrder: session.slotOrder,
    rosters,
    existingUserIds: users.map((user) => user.id),
    commissionerUserId: league.userId,
    commissionerPlays: normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown> | null)
      .commissionerParticipationMode === 'participating_player',
  })
  if (!cast.ready) return cast

  if (league.sport === 'NBA') {
    const template = await getEffectiveLeagueRosterTemplate(leagueId)
    const rosterSpots = template.template.slots.reduce((sum, slot) =>
      sum + (slot.starterCount ?? 0) + (slot.benchCount ?? 0), 0)
    if (rosterSpots !== session.rounds) {
      return { ready: false, error: `The NBA roster has ${rosterSpots} draftable spots per team but the draft has ${session.rounds} rounds. Match these in commissioner settings before starting.` }
    }
    const roster = await loadNbaSurvivorRosterEligibility(session.teamCount * session.rounds)
    if (!roster.ready) return { ready: false, error: roster.reason ?? 'Current NBA roster unavailable.' }
  }

  const savedPlan = readSurvivorFullSeasonPlan(league.settings)
  if (savedPlan) {
    try {
      buildSurvivorFullSeasonPlan({
        sport: savedPlan.sport,
        season: savedPlan.season,
        castSize: savedPlan.castSize,
        endWeek: savedPlan.endWeek,
        exileEnabled: savedPlan.exileReturnSlots === 1,
        exileReturnWeek: savedPlan.exileReturnWeek,
      })
    } catch (error) {
      return { ready: false, error: error instanceof Error ? error.message : 'The Survivor season calendar needs review before drafting.' }
    }
  }
  return { ready: true }
}
