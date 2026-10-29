import 'server-only'

import { withSurvivorSetupTransaction } from './survivorSetupTransaction'

import type { Prisma } from '@prisma/client'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { buildSurvivorIntroAnnouncement, buildSurvivorIntroSummary, type SurvivorIntroContext } from './survivorPromptTemplates'
import { createSurvivorChatMessage } from './survivorChatBridge'

const HOST_USER_ID = 'survivor-host-chimmy'
const HOST_NAME = 'Chimmy (Host)'
const INTRO_CONTENT_TYPE = 'survivor_intro'

export type SurvivorAnnouncementOutcome = {
  ok: true
  posted: boolean
  pending: boolean
  channelId: string | null
  messageId: string | null
  summary: string
  detail: string
}

function buildIntroContext(leagueName: string, sport: string, settings: ReturnType<typeof normalizeSurvivorFoundationSettings>, castSize: number, tribeCount: number): SurvivorIntroContext {
  return {
    leagueName,
    sport,
    castSize,
    tribeCount,
    mergeAtActivePlayers: settings.mergeActivePlayerCount,
    privateVotesOnly: true,
    coManagerDisallowed: true,
    screenshotsAllowedExceptHostDm: true,
  }
}

/**
 * Post (or persist as pending) the Survivor host intro/rules announcement.
 *
 * If a league chat channel exists, a real host `SurvivorChatMessage` is posted (idempotent —
 * an existing intro message is not duplicated). If no channel exists yet, an audit event is
 * recorded so the dashboard can show a TRUTHFUL "intro pending" state — never a fake message.
 */
export async function postSurvivorIntroAnnouncement(
  leagueId: string,
  opts: { actorUserId?: string; db?: Prisma.TransactionClient } = {},
): Promise<SurvivorAnnouncementOutcome> {
  if (!opts.db) return withSurvivorSetupTransaction(leagueId, (db) => postSurvivorIntroAnnouncement(leagueId, { ...opts, db }))
  const db = opts.db
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { name: true, sport: true, settings: true } })
  const settings = normalizeSurvivorFoundationSettings(
    league?.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {},
  )
  const castSize = await db.survivorPlayer.count({ where: { leagueId } })
  const tribeCount = await db.survivorTribe.count({ where: { leagueId } })
  const ctx = buildIntroContext(league?.name ?? 'Survivor', String(league?.sport ?? 'NFL'), settings, castSize || settings.defaultTeamCount, tribeCount || settings.tribeCount)
  const summary = buildSurvivorIntroSummary(ctx)

  const channel = await db.survivorChatChannel.findFirst({
    where: { leagueId, channelType: 'league', isArchived: false },
    select: { id: true },
  })

  if (!channel) {
    // No chat infra yet → persist a pending announcement event truthfully (no fake message).
    await db.survivorAuditEntry.create({
      data: {
        leagueId,
        category: 'announcement',
        action: 'intro_pending',
        actorUserId: opts.actorUserId ?? null,
        data: { summary, reason: 'no_league_chat_channel' },
        isVisibleToCommissioner: true,
        isVisibleToPublic: true,
      },
    })
    return { ok: true, posted: false, pending: true, channelId: null, messageId: null, summary, detail: 'No league chat channel yet — intro persisted as pending.' }
  }

  const existing = await db.survivorChatMessage.findFirst({
    where: { leagueId, channelId: channel.id, contentType: INTRO_CONTENT_TYPE },
    select: { id: true },
  })
  if (existing) {
    return { ok: true, posted: false, pending: false, channelId: channel.id, messageId: existing.id, summary, detail: 'Intro already posted (idempotent).' }
  }

  const message = await createSurvivorChatMessage(db, {
    data: {
      leagueId,
      channelId: channel.id,
      channelType: 'league',
      senderUserId: HOST_USER_ID,
      senderName: HOST_NAME,
      senderIsHost: true,
      isSystemMessage: true,
      content: buildSurvivorIntroAnnouncement(ctx),
      contentType: INTRO_CONTENT_TYPE,
      isPinned: true,
      pinnedAt: new Date(),
    },
    select: { id: true },
  })

  await db.survivorAuditEntry.create({
    data: {
      leagueId,
      category: 'announcement',
      action: 'intro_posted',
      actorUserId: opts.actorUserId ?? null,
      data: { channelId: channel.id, messageId: message.id, summary },
      isVisibleToCommissioner: true,
      isVisibleToPublic: true,
    },
  })

  return { ok: true, posted: true, pending: false, channelId: channel.id, messageId: message.id, summary, detail: 'Intro posted to league chat.' }
}

export function getSurvivorIntroStatusSummary(): { hostUserId: string; contentType: string } {
  return { hostUserId: HOST_USER_ID, contentType: INTRO_CONTENT_TYPE }
}
