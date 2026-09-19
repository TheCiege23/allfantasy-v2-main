import 'server-only'

import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'

export type ConferencePlanItem = {
  id?: string
  clientId: string
  name: string
  colorHex?: string | null
  active: boolean
  leagueIds: string[]
}

export type ConferencePlanOutcome =
  | {
      ok: true
      movedLeagues: number
      createdConferences: number
      archivedConferences: number
      restoredConferences: number
      membershipLocked: boolean
    }
  | { ok: false; error: string; status: 400 | 404 | 409 }

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'conference'
}

/**
 * Applies the commissioner's reviewed conference plan to the current round.
 *
 * League membership is mutable until advancement has run for the current round.
 * Names, empty conference lifecycle, and display order remain editable afterward;
 * none of those change who qualified. Historical rounds are never rewritten.
 */
export async function applyConferencePlan(args: {
  tournamentId: string
  commissionerUserId: string
  conferences: ConferencePlanItem[]
  expectedConferences?: ConferencePlanItem[]
}): Promise<ConferencePlanOutcome> {
  const { tournamentId, commissionerUserId } = args
  const requested = args.conferences.map((conference) => ({
    ...conference,
    id: conference.id?.trim() || undefined,
    clientId: conference.clientId?.trim(),
    name: conference.name?.trim(),
    colorHex: conference.colorHex?.trim() || null,
    active: Boolean(conference.active),
    leagueIds: [...new Set((conference.leagueIds ?? []).map((id) => id.trim()).filter(Boolean))],
  }))

  if (requested.length === 0) {
    return { ok: false, error: 'Keep at least one active conference.', status: 400 }
  }
  if (requested.some((conference) => !conference.clientId || !conference.name)) {
    return { ok: false, error: 'Every conference needs a name.', status: 400 }
  }
  if (requested.some((conference) => conference.name.length > 64)) {
    return { ok: false, error: 'Conference names must be 64 characters or fewer.', status: 400 }
  }
  if (requested.some((conference) => conference.colorHex && !/^#[0-9a-f]{6}$/i.test(conference.colorHex))) {
    return { ok: false, error: 'Conference colors must use a six-digit hex value.', status: 400 }
  }
  const active = requested.filter((conference) => conference.active)
  if (active.length < 1 || active.length > 8) {
    return { ok: false, error: 'A tournament needs between 1 and 8 active conferences.', status: 400 }
  }
  const normalizedNames = active.map((conference) => conference.name.toLocaleLowerCase())
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    return { ok: false, error: 'Active conference names must be unique.', status: 400 }
  }
  if (requested.some((conference) => !conference.active && conference.leagueIds.length > 0)) {
    return { ok: false, error: 'Move every league out before archiving a conference.', status: 400 }
  }

  const shell = await prisma.tournamentShell.findFirst({
    where: { id: tournamentId, commissionerId: commissionerUserId },
    select: { id: true, currentRoundNumber: true },
  })
  if (!shell) return { ok: false, error: 'Tournament not found', status: 404 }

  const round = await prisma.tournamentRound.findFirst({
    where: { tournamentId, roundNumber: shell.currentRoundNumber || 1 },
    select: { id: true, roundNumber: true },
  })
  if (!round) return { ok: false, error: 'Current tournament round not found.', status: 404 }

  const [existingConferences, currentLeagues, currentAdvancementCount, anyAdvancementCount] =
    await Promise.all([
      prisma.tournamentConference.findMany({
        where: { tournamentId },
        orderBy: { conferenceNumber: 'asc' },
        select: { id: true, name: true, slug: true, colorHex: true, conferenceNumber: true, isActive: true },
      }),
      prisma.tournamentLeague.findMany({
        where: { tournamentId, roundId: round.id },
        orderBy: { leagueNumber: 'asc' },
        select: { id: true, conferenceId: true, leagueNumber: true },
      }),
      prisma.tournamentAdvancementGroup.count({ where: { tournamentId, fromRoundId: round.id } }),
      prisma.tournamentAdvancementGroup.count({ where: { tournamentId } }),
    ])

  const existingIds = new Set(existingConferences.map((conference) => conference.id))
  const requestedExistingIds = requested.flatMap((conference) => (conference.id ? [conference.id] : []))
  if (
    requestedExistingIds.some((id) => !existingIds.has(id)) ||
    requestedExistingIds.length !== existingConferences.length ||
    new Set(requestedExistingIds).size !== existingConferences.length
  ) {
    return {
      ok: false,
      error: 'The conference list changed while you were editing. Reload and review it again.',
      status: 409,
    }
  }

  if (args.expectedConferences) {
    const normalizedExpected = args.expectedConferences
      .map((conference) => ({
        id: conference.id ?? null,
        name: conference.name.trim(),
        colorHex: conference.colorHex ?? null,
        active: Boolean(conference.active),
        leagueIds: conference.leagueIds,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    const actual = existingConferences
      .map((conference) => ({
        id: conference.id,
        name: conference.name.trim(),
        colorHex: conference.colorHex ?? null,
        active: conference.isActive,
        leagueIds: currentLeagues
          .filter((league) => league.conferenceId === conference.id)
          .map((league) => league.id),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    if (JSON.stringify(normalizedExpected) !== JSON.stringify(actual)) {
      return {
        ok: false,
        error: 'Conference assignments changed while you were editing. Reload and review the latest setup.',
        status: 409,
      }
    }
  }

  const expectedLeagueIds = currentLeagues.map((league) => league.id).sort()
  const plannedLeagueIds = active.flatMap((conference) => conference.leagueIds).sort()
  if (
    plannedLeagueIds.length !== expectedLeagueIds.length ||
    plannedLeagueIds.some((id, index) => id !== expectedLeagueIds[index])
  ) {
    return {
      ok: false,
      error: 'Every current-round league must appear exactly once. Reload and review the assignments.',
      status: 409,
    }
  }

  for (const conference of requested) {
    if (!conference.id && !conference.active) {
      return { ok: false, error: 'Remove an unsaved conference instead of archiving it.', status: 400 }
    }
  }

  const planByLeague = new Map<string, string>()
  for (const conference of active) {
    for (const leagueId of conference.leagueIds) planByLeague.set(leagueId, conference.clientId)
  }
  const existingClientIdByConference = new Map(
    requested.filter((conference) => conference.id).map((conference) => [conference.id!, conference.clientId]),
  )
  const moved = currentLeagues.filter(
    (league) => planByLeague.get(league.id) !== existingClientIdByConference.get(league.conferenceId ?? ''),
  )
  const membershipLocked = currentAdvancementCount > 0
  if (membershipLocked && moved.length > 0) {
    return {
      ok: false,
      error: 'This round has already advanced. League membership is locked so recorded results cannot change.',
      status: 409,
    }
  }

  const maxConferenceNumber = Math.max(0, ...existingConferences.map((conference) => conference.conferenceNumber))
  const usedSlugs = new Set(existingConferences.map((conference) => conference.slug))
  const resolvedIdByClientId = new Map<string, string>()
  const newRows: Array<ConferencePlanItem & { resolvedId: string; conferenceNumber: number; slug: string }> = []
  let nextConferenceNumber = maxConferenceNumber
  for (const conference of requested) {
    if (conference.id) {
      resolvedIdByClientId.set(conference.clientId, conference.id)
      continue
    }
    const resolvedId = randomUUID()
    let slug = slugify(conference.name)
    let suffix = 2
    while (usedSlugs.has(slug)) slug = `${slugify(conference.name)}-${suffix++}`
    usedSlugs.add(slug)
    nextConferenceNumber += 1
    resolvedIdByClientId.set(conference.clientId, resolvedId)
    newRows.push({ ...conference, resolvedId, conferenceNumber: nextConferenceNumber, slug })
  }

  const leagueOrder = new Map<string, number>()
  let order = 0
  for (const conference of active) {
    for (const leagueId of conference.leagueIds) leagueOrder.set(leagueId, ++order)
  }
  const createdConferences = newRows.length
  const archivedConferences = requested.filter((conference) => {
    const existing = existingConferences.find((candidate) => candidate.id === conference.id)
    return existing?.isActive && !conference.active
  }).length
  const restoredConferences = requested.filter((conference) => {
    const existing = existingConferences.find((candidate) => candidate.id === conference.id)
    return existing && !existing.isActive && conference.active
  }).length

  await prisma.$transaction(async (tx) => {
    for (const conference of newRows) {
      await tx.tournamentConference.create({
        data: {
          id: conference.resolvedId,
          tournamentId,
          name: conference.name,
          colorHex: conference.colorHex,
          slug: conference.slug,
          conferenceNumber: conference.conferenceNumber,
          isActive: true,
        },
      })
    }
    for (const conference of requested.filter((item) => item.id)) {
      await tx.tournamentConference.update({
        where: { id: conference.id! },
        data: {
          name: conference.name,
          colorHex: conference.colorHex,
          isActive: conference.active,
          standingsCache: Prisma.JsonNull,
        },
      })
    }
    for (const league of currentLeagues) {
      const clientId = planByLeague.get(league.id)!
      const conferenceId = resolvedIdByClientId.get(clientId)!
      await tx.tournamentLeague.update({
        where: { id: league.id },
        data: { conferenceId, leagueNumber: leagueOrder.get(league.id)! },
      })
      if (conferenceId !== league.conferenceId) {
        const leagueParticipants = await tx.tournamentLeagueParticipant.findMany({
          where: { tournamentLeagueId: league.id },
          select: { participantId: true },
        })
        const participantIds = leagueParticipants.map((participant) => participant.participantId)
        if (participantIds.length > 0) {
          await tx.tournamentParticipant.updateMany({
            where: { id: { in: participantIds } },
            data: {
              currentConferenceId: conferenceId,
              ...(anyAdvancementCount === 0 ? { originalConferenceId: conferenceId } : {}),
            },
          })
          await tx.tournamentLeagueParticipant.updateMany({
            where: { tournamentLeagueId: league.id },
            data: { conferenceRank: null },
          })
        }
      }
    }
    await tx.tournamentShell.update({
      where: { id: tournamentId },
      data: {
        conferenceCount: active.length,
        leaguesPerConference: Math.max(0, ...active.map((conference) => conference.leagueIds.length)),
      },
    })
    await tx.tournamentAuditLog.create({
      data: {
        tournamentId,
        roundNumber: round.roundNumber,
        action: 'tournament.conferences_managed',
        actorType: 'commissioner',
        actorId: commissionerUserId,
        data: toPrismaJsonInput({
          movedLeagueIds: moved.map((league) => league.id),
          createdConferences,
          archivedConferences,
          restoredConferences,
          membershipLocked,
          plan: requested.map((conference) => ({
            id: conference.id ?? resolvedIdByClientId.get(conference.clientId),
            name: conference.name,
            colorHex: conference.colorHex,
            active: conference.active,
            leagueIds: conference.leagueIds,
          })),
        }),
      },
    })
  })

  return {
    ok: true,
    movedLeagues: moved.length,
    createdConferences,
    archivedConferences,
    restoredConferences,
    membershipLocked,
  }
}
