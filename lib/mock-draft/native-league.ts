import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { buildRosterIdResolver, draftOrderSlotsToSlotOrder } from '@/lib/league/league-settings-draft-sync'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

type OrderSlot = { slot: number; rosterId: string; displayName: string }
function completeOrder(value: unknown, count: number): OrderSlot[] | null {
  if (!Array.isArray(value) || value.length !== count) return null
  const rows: OrderSlot[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const row = raw as Record<string, unknown>
    if (!Number.isInteger(row.slot) || Number(row.slot) < 1 || Number(row.slot) > count || typeof row.rosterId !== 'string') return null
    rows.push({ slot: Number(row.slot), rosterId: row.rosterId, displayName: typeof row.displayName === 'string' ? row.displayName : '' })
  }
  if (new Set(rows.map(row => row.slot)).size !== count || new Set(rows.map(row => row.rosterId)).size !== count) return null
  return rows.sort((a, b) => a.slot - b.slot)
}

/** Read-only native preview. Native UUIDs must never be sent to Sleeper's league API. */
export async function getNativeLeagueMock(leagueId: string, userId: string) {
  const candidate = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (!candidate || !isNativePlatform(candidate.platform)) return null
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return { status: membership.status, body: { error: membership.reason === 'not_member' ? 'League membership required' : 'League not found' } }

  const [league, draft, config, roster] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        id: true, name: true, platformLeagueId: true, sport: true, scoring: true, isDynasty: true, leagueSize: true,
        rosters: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, platformUserId: true } },
        teams: { select: { id: true, externalId: true, claimedByUserId: true, platformUserId: true, ownerName: true, avatarUrl: true, role: true, isOrphan: true, wins: true, losses: true, ties: true, pointsFor: true } },
        leagueEntrySlots: { orderBy: { slotNumber: 'asc' }, select: { slotNumber: true, rosterId: true, status: true } },
        leagueSettings: { select: { draftOrderSlots: true } },
      },
    }),
    prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { teamCount: true, rounds: true, draftType: true, slotOrder: true } }),
    getDraftConfigForLeague(leagueId),
    getEffectiveLeagueRosterTemplate(leagueId),
  ])
  if (!league || !config) return { status: 404, body: { error: 'League not found' } }
  const teamCount = Math.max(2, league.leagueSize || draft?.teamCount || league.rosters.length)
  const resolveRosterId = buildRosterIdResolver(league.rosters, league.teams)
  const savedOrder = completeOrder(draft?.slotOrder, teamCount) ?? completeOrder(
    draftOrderSlotsToSlotOrder(league.leagueSettings?.draftOrderSlots, teamCount, resolveRosterId), teamCount,
  )
  // Entry slots provide stable order before a draft exists. Never zip unordered teams to rosters.
  const entryBySlot = new Map(league.leagueEntrySlots.map(seat => [seat.slotNumber, seat]))
  const seatedRosterIds = new Set(league.leagueEntrySlots.map(seat => seat.rosterId).filter(Boolean))
  const unseatedRosters = league.rosters.filter(row => !seatedRosterIds.has(row.id))
  const fallbackOrder = Array.from({ length: teamCount }, (_, index) => {
    const slot = index + 1
    const entry = entryBySlot.get(slot)
    return { slot, rosterId: (entry ? entry.rosterId : unseatedRosters.shift()?.id) ?? `open-${slot}`, displayName: '' }
  })
  const teamByRoster = new Map(league.teams.flatMap(team => {
    const id = resolveRosterId(team.id)
    return id ? [[id, team] as const] : []
  }))
  const rosterById = new Map(league.rosters.map(row => [row.id, row]))
  const managers = (savedOrder ?? fallbackOrder).map(row => {
    const team = teamByRoster.get(row.rosterId)
    const seat = league.leagueEntrySlots.find(s => s.rosterId === row.rosterId)
    const ownerId = rosterById.get(row.rosterId)?.platformUserId
    const isUser = ownerId === userId || team?.claimedByUserId === userId
    const isOrphan = seat?.status === 'OPEN' || !ownerId || ownerId.startsWith('open-slot-') || team?.isOrphan === true
    return {
      slot: row.slot,
      // This numeric ID is local to the simulator; live roster UUIDs stay server-side.
      rosterId: row.slot, managerId: ownerId ?? row.rosterId,
      managerName: team?.ownerName || row.displayName || `Open slot ${row.slot}`,
      avatarUrl: team?.avatarUrl ?? null, isUser, isOrphan,
      slotPredicted: !savedOrder, role: team?.role ?? null,
      record: { wins: team?.wins ?? 0, losses: team?.losses ?? 0, ties: team?.ties ?? 0, pointsFor: team?.pointsFor ?? 0 },
    }
  })
  const rosterSlots = [
    ...roster.template.slots.flatMap(slot => Array.from({ length: slot.starterCount }, () => slot.slotName)),
    ...roster.template.slots.flatMap(slot => Array.from({ length: slot.benchCount }, () => slot.slotName)),
  ]
  const scoring = (league.scoring ?? (league.sport === 'NFL' || league.sport === 'NCAAF' ? 'Standard' : 'Points')).toLowerCase()
  const scoringLabel = scoring.includes('half') ? 'Half PPR' : scoring.includes('ppr') ? 'PPR' : scoring.includes('categor') ? 'Categories' : scoring.includes('point') ? 'Points' : 'Standard'
  const draftType = draft?.draftType ?? config.draft_type
  return {
    status: 200,
    body: { league: {
      leagueId: league.id, platformLeagueId: league.platformLeagueId, leagueName: league.name,
      sport: normalizeToSupportedSport(league.sport), scoring: scoringLabel, isDynasty: league.isDynasty,
      teamCount, rounds: draft?.rounds ?? config.rounds,
      draftType: draftType === 'linear' || draftType === 'auction' ? draftType : 'snake',
      superflex: roster.superflexSlotNames.length > 0, rosterSlots,
      managers, detectedUserSlot: managers.find(manager => manager.isUser)?.slot ?? 1,
      hasExplicitDraftOrder: Boolean(savedOrder),
    } },
  }
}
