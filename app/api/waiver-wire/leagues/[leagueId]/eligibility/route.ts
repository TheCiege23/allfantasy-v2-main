import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { assertWaiverClaimEligibility } from "@/lib/waiver-wire/transaction-eligibility"
import { getEffectiveLeagueWaiverSettings } from "@/lib/waiver-wire"
import { getLeagueRole } from "@/lib/league/permissions"
import { mergeCommissionerOverrides } from "@/lib/waiver-wire/commissioner-claim-override"
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedWaiverIntegrationService, type CertifiedScheduleDescription } from '@/lib/fantasy-os/sports-runtime/waiverIntegration'
import { extractPlayerRefs } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'

/**
 * POST — validate a waiver claim before submit (popup copy, mobile, AI tools).
 * Body: { addPlayerId, dropPlayerId?, faabBid?, metadata?, commissionerOverrides? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leagueId = params.leagueId
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  if (!roster) return NextResponse.json({ error: "Roster not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const addPlayerId = body.addPlayerId ?? body.add_player_id
  if (!addPlayerId) return NextResponse.json({ error: "addPlayerId required" }, { status: 400 })

  try {
    let claimMetadata: Record<string, unknown> | undefined =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? { ...(body.metadata as Record<string, unknown>) }
        : undefined

    if (
      body.commissionerOverrides &&
      typeof body.commissionerOverrides === "object" &&
      !Array.isArray(body.commissionerOverrides)
    ) {
      const role = await getLeagueRole(leagueId, userId)
      if (role === "commissioner" || role === "co_commissioner") {
        const co = body.commissionerOverrides as Record<string, unknown>
        const patch: Parameters<typeof mergeCommissionerOverrides>[1] = { setByUserId: userId }
        if (typeof co.bypassInsufficientFaab === "boolean") patch.bypassInsufficientFaab = co.bypassInsufficientFaab
        if (typeof co.bypassWeeklyDropLimit === "boolean") patch.bypassWeeklyDropLimit = co.bypassWeeklyDropLimit
        if (typeof co.note === "string") patch.note = co.note
        claimMetadata = mergeCommissionerOverrides(claimMetadata ?? null, patch)
      }
    }

    await assertWaiverClaimEligibility({
      leagueId,
      rosterId: roster.id,
      addPlayerId: String(addPlayerId),
      dropPlayerId: body.dropPlayerId ?? body.drop_player_id ?? null,
      faabBid: body.faabBid ?? body.faab_bid ?? null,
      claimMetadata,
    })
    const settings = await getEffectiveLeagueWaiverSettings(leagueId)

    // Gated, informational certified SCHEDULE evidence only (kickoff/status/lock/freshness/identity) for the
    // add/drop players. Never blocks eligibility and never mutates. Injuries/projections/availability/rankings
    // are NOT provided by the certified schedule plane and are surfaced as explicitly `unavailable`. Wrapped so
    // it can never fail the preview.
    let sportsSchedule: CertifiedScheduleDescription | undefined
    if (isSportsDataEnabled('waiver')) {
      try {
        const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
        if (league && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
          const dropId = body.dropPlayerId ?? body.drop_player_id ?? null
          const refs = extractPlayerRefs([String(addPlayerId), ...(dropId ? [String(dropId)] : [])])
          sportsSchedule = await new CertifiedWaiverIntegrationService().describeWaiverScheduleContext({
            season: String(league.season ?? new Date().getFullYear()),
            week: String(weekFromLeagueSettingsForLineup(league.settings)),
            players: refs,
          })
        }
      } catch {
        sportsSchedule = undefined
      }
    }

    return NextResponse.json({
      ok: true,
      normalizedWaiverType: settings.normalizedWaiverType,
      faabMinBid: settings.faabMinBid,
      allowZeroFaabBid: settings.allowZeroFaabBid,
      maxDropsPerWeek: settings.maxDropsPerWeek,
      ...(sportsSchedule ? { sportsSchedule } : {}),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Not eligible"
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
