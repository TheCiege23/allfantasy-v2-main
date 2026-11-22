import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { resolveLeagueAccess } from '@/lib/league-access'
import { findOrCreateDirectThread } from '@/lib/chat-notifications/tradeOfferDm'
import {
  AWARD_BALLOT_SUBTYPE, AWARD_DM_PREFIX, awardBallotHref, awardClosed, awardTallies, readAwardBallot,
  recordAwardChoice, type AwardBallot,
} from './awardBallot'

function deterministicId(seed: string) {
  const h = createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export async function publishAwardBallot(input: {
  leagueId: string; userId: string; name: string; choices: string[]; closeAt: string; requestId: string
}) {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId }, select: { id: true, name: true, platform: true, season: true },
  })
  if (!league) return null
  const id = deterministicId(`award-ballot:${league.id}:${input.userId}:${input.requestId}`)
  const link = awardBallotHref(league.id, id)
  const site = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.allfantasy.ai').replace(/\/$/, '')
  const url = new URL(link, site).toString()
  const native = isNativePlatform(league.platform)
  const ballot: AwardBallot = {
    name: input.name, closeAt: input.closeAt, season: league.season,
    options: input.choices.map((label, i) => ({ label, id: `opt-${i}` })), votes: [],
  }
  const members = native ? await nativeAwardRecipients(league.id, input.userId) : []
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.leagueAwardBallot.createMany({
      data: { id, leagueId: league.id, createdByUserId: input.userId, closesAt: new Date(input.closeAt), data: { awardBallot: ballot } },
      skipDuplicates: true,
    })
    if (count === 0) return
    await tx.leagueChatMessage.create({
      data: { id, leagueId: league.id, userId: input.userId, type: 'text', messageSubtype: AWARD_BALLOT_SUBTYPE,
        message: `Vote for ${input.name} on AllFantasy: ${url}`,
      },
    })
    if (members.length) await tx.sportsDataCache.createMany({
      data: members.map((recipient) => ({
        cacheKey: `${AWARD_DM_PREFIX}${id}:${recipient}`,
        data: { leagueId: league.id, ballotId: id, recipient },
        expiresAt: new Date(input.closeAt),
      })),
      skipDuplicates: true,
    })
  })
  return { id, href: link }
}

async function nativeAwardRecipients(leagueId: string, sender: string) {
  const [teams, redraft, rosters, coOwners] = await Promise.all([
    prisma.leagueTeam.findMany({ where: { leagueId, isOrphan: false, claimedByUserId: { not: null } }, select: { claimedByUserId: true } }),
    prisma.redraftLeagueMember.findMany({ where: { leagueId }, select: { userId: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { managerUserId: true, platformUserId: true } }),
    prisma.teamCoOwner.findMany({ where: { leagueId, acceptedAt: { not: null } }, select: { userId: true } }),
  ])
  const identities = [...new Set([
    ...teams.map((r) => r.claimedByUserId), ...redraft.map((r) => r.userId),
    ...rosters.flatMap((r) => [r.managerUserId, r.platformUserId]), ...coOwners.map((r) => r.userId),
  ].filter((id): id is string => Boolean(id) && id !== sender))]
  if (!identities.length) return []
  const accounts = await prisma.appUser.findMany({ where: { id: { in: identities } }, select: { id: true } })
  return accounts.map((account) => account.id)
}

/** Lock only the selected award so simultaneous ballots and early close serialize. */
export async function updateAwardBallot(leagueId: string, messageId: string, action: { userId: string; optionId: string } | 'close') {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ data: unknown }>>`
      SELECT data FROM league_award_ballots
      WHERE id = ${messageId} AND "leagueId" = ${leagueId}
      FOR UPDATE
    `
    const ballot = readAwardBallot(row?.data)
    if (!ballot) return { ok: false as const, status: 404, error: 'Ballot not found.' }
    const next = action === 'close'
      ? { ok: true as const, ballot: { ...ballot, closedAt: ballot.closedAt || new Date().toISOString() } }
      : recordAwardChoice(ballot, action.userId, action.optionId)
    if (!next.ok) return next
    await tx.leagueAwardBallot.update({
      where: { id: messageId }, data: { data: { awardBallot: next.ballot } },
    })
    return { ok: true as const }
  })
}

export async function readLeagueAwardBallots(leagueId: string) {
  const rows = await prisma.leagueAwardBallot.findMany({
    where: { leagueId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: { id: true, data: true },
  })
  return rows.flatMap((row) => {
    const ballot = readAwardBallot(row.data)
    return ballot ? [{ id: row.id, ballot }] : []
  })
}

export async function exportLeagueAwards(leagueId: string) {
  const [league, rows] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } }),
    readLeagueAwardBallots(leagueId),
  ])
  return { leagueId, league: league?.name ?? 'League', awards: rows.map(({ id, ballot }) => ({
    id, name: ballot.name, season: ballot.season, closesAt: ballot.closeAt, ...awardTallies(ballot),
  })) }
}

async function deliverAwardDm(row: { cacheKey: string; data: Prisma.JsonValue }) {
  const payload = row.data as { leagueId?: string; ballotId?: string; recipient?: string }
  if (!payload?.leagueId || !payload?.ballotId || !payload?.recipient) return true
  const [message, league] = await Promise.all([
    prisma.leagueAwardBallot.findFirst({ where: { id: payload.ballotId, leagueId: payload.leagueId },
      select: { createdByUserId: true, data: true } }),
    prisma.league.findUnique({ where: { id: payload.leagueId }, select: { platform: true } }),
  ])
  const ballot = readAwardBallot(message?.data)
  if (!league || !isNativePlatform(league.platform) || !message || !ballot || awardClosed(ballot)) return true
  const recipient = payload.recipient
  if (!await resolveLeagueAccess(payload.leagueId, recipient)) return true
  const id = deterministicId(row.cacheKey)
  if (await prisma.platformChatMessage.findUnique({ where: { id }, select: { id: true } })) return true
  const dm = await findOrCreateDirectThread(message.createdByUserId, recipient)
  if ('refused' in dm) return dm.refused !== 'thread_failed'

  const href = new URL(awardBallotHref(payload.leagueId, payload.ballotId), process.env.NEXT_PUBLIC_APP_URL || 'https://www.allfantasy.ai')
  const body = [`Vote for ${ballot.name} on AllFantasy: ${href}`, '', ...ballot.options.map((option) => `• ${option.label}`)].join('\n')
  await prisma.$transaction(async (tx) => {
    const result = await tx.platformChatMessage.createMany({
      data: { id, threadId: dm.threadId, senderUserId: message.createdByUserId, messageType: 'text', body },
      skipDuplicates: true,
    })
    if (result.count) await tx.platformChatThread.update({ where: { id: dm.threadId }, data: { lastMessageAt: new Date() } })
  })
  return true
}

export async function relayAwardBallotDms(limit = 24) {
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: AWARD_DM_PREFIX }, expiresAt: { gt: new Date() } },
    orderBy: [{ createdAt: 'asc' }, { cacheKey: 'asc' }], take: limit,
  })
  let done = 0
  for (let i = 0; i < rows.length; i += 4) {
    await Promise.all(rows.slice(i, i + 4).map(async (row) => {
      if (await deliverAwardDm(row).catch(() => false)) {
        await prisma.sportsDataCache.deleteMany({ where: { cacheKey: row.cacheKey } })
        done++
      } else {
        await prisma.sportsDataCache.updateMany({ where: { cacheKey: row.cacheKey }, data: { createdAt: new Date() } })
      }
    }))
  }
  return { processed: rows.length, done }
}
