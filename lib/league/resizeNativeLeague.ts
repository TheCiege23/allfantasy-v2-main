import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

const PRE_DRAFT = ['pre_draft', 'configuring', 'configured']

/** Resize only pre-draft native seats. Claimed or populated seats are never removed. */
export async function resizeNativeLeague(leagueId: string, size: number, patch: Prisma.LeagueUpdateInput) {
  if (!Number.isInteger(size) || size < 2 || size > 32) throw new Error('Team count must be between 2 and 32.')
  return prisma.$transaction(async tx => {
    const [slots, teams, rosters, sessions, season] = await Promise.all([
      tx.leagueEntrySlot.findMany({ where: { leagueId }, orderBy: { slotNumber: 'asc' } }),
      tx.leagueTeam.findMany({ where: { leagueId } }),
      tx.roster.findMany({ where: { leagueId } }),
      tx.draftSession.findMany({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER }),
      tx.redraftSeason.findFirst({ where: { leagueId }, select: { id: true } }),
    ])
    if (season || sessions.some(s => !PRE_DRAFT.includes(s.status))) throw new Error('Team count cannot change after drafting starts.')
    if (!slots.length) throw new Error('League seats need to be configured before changing team count.')
    const removed = slots.filter(s => s.slotNumber > size)
    const removedRosterIds = removed.flatMap(s => s.rosterId ? [s.rosterId] : [])
    for (const slot of removed) {
      const roster = rosters.find(r => r.id === slot.rosterId)
      const team = teams.find(t => t.externalId === slot.rosterId)
      const data = roster?.playerData as Record<string, unknown> | null
      const picks = data && !Array.isArray(data) ? data.draftPicks : undefined
      if (slot.status !== 'OPEN' || team?.claimedByUserId || !roster?.platformUserId.startsWith('open-slot-') ||
          Array.isArray(roster.playerData) && roster.playerData.length > 0 || Array.isArray(picks) && picks.length > 0) {
        throw new Error('Only empty open seats at the end of the league can be removed. Move managers out of those seats first.')
      }
    }
    if (removed.length) {
      await tx.leagueEntrySlot.deleteMany({ where: { id: { in: removed.map(s => s.id) } } })
      await tx.leagueTeam.deleteMany({ where: { leagueId, externalId: { in: removedRosterIds }, claimedByUserId: null } })
      await tx.roster.deleteMany({ where: { leagueId, id: { in: removedRosterIds }, platformUserId: { startsWith: 'open-slot-' } } })
    }
    const order = slots.filter(s => s.slotNumber <= size).map(s => ({ slot: s.slotNumber, rosterId: s.rosterId ?? 'placeholder-' + s.slotNumber,
      displayName: teams.find(t => t.externalId === s.rosterId)?.teamName ?? 'Team ' + s.slotNumber }))
    for (let slot = 1; slot <= size; slot++) {
      if (slots.some(s => s.slotNumber === slot)) continue
      const name = 'Open Team ' + slot
      const roster = await tx.roster.create({ data: { leagueId, platformUserId: 'open-slot-' + leagueId + '-' + slot,
        playerData: { draftPicks: [], foundation: { slotNumber: slot, openTeam: true, label: name, createdBy: 'commissioner_resize' } },
        settings: { openSlot: true, aiManaged: false } } })
      await tx.leagueTeam.create({ data: { leagueId, externalId: roster.id, platformUserId: roster.platformUserId,
        ownerName: name, teamName: name, isOrphan: true, claimedByUserId: null, role: 'member' } })
      await tx.leagueEntrySlot.create({ data: { leagueId, slotNumber: slot, rosterId: roster.id, status: 'OPEN' } })
      order.push({ slot, rosterId: roster.id, displayName: name })
    }
    order.sort((a,b) => a.slot - b.slot)
    // Preserve each draft's existing order where possible; append newly added empty seats.
    let settingsOrder = order
    for (const session of sessions) {
      const previous = Array.isArray(session.slotOrder) ? session.slotOrder as unknown as typeof order : []
      const allowed = new Set(order.map(s => s.rosterId))
      const kept = previous.filter(s => allowed.has(s.rosterId))
      const next = [...kept, ...order.filter(s => !kept.some(k => k.rosterId === s.rosterId))].map((s,i) => ({ ...s, slot: i + 1 }))
      if (session.id === sessions[0]?.id) settingsOrder = next
      await tx.draftSession.update({ where: { id: session.id }, data: { teamCount: size, slotOrder: next, version: { increment: 1 } } })
    }
    await tx.leagueSettings.updateMany({ where: { leagueId }, data: { draftOrderSlots: settingsOrder.map(s => ({ slot: s.slot, ownerId: s.rosterId, ownerName: s.displayName })) } })
    await tx.league.update({ where: { id: leagueId }, data: { ...patch, leagueSize: size } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 })
}
