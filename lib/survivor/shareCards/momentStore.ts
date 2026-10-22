import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { buildShareCardContent, SHARE_MOMENT_OFFERED, SHARE_MOMENT_TITLES, shareIconPath } from './cardContent'
import { canPublishMoment, isMomentOfferedTo, isMomentPublic, type ViewerFacts } from './momentAccess'
import {
  isShareMomentType,
  type ShareCardFormat,
  type ShareMomentListItem,
  type ShareMomentPayload,
  type ShareMomentRecord,
  type ShareMomentType,
} from './types'
import { createSurvivorChatMessage } from '../survivorChatBridge'

/**
 * Persistence for Survivor share moments. Every read degrades to "no moments" when the table has
 * not been migrated yet (P2021), so shipping the code ahead of the migration hides the feature
 * rather than breaking the Survivor pages that mount it.
 */

type Row = {
  id: string
  leagueId: string
  type: string
  week: number
  subjectUserId: string
  subjectRosterId: string | null
  payload: Prisma.JsonValue
  final: boolean
  publishedAt: Date | null
  createdAt: Date
}

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'P2021' || code === 'P2022'
}

export function toShareMomentRecord(row: Row): ShareMomentRecord | null {
  if (!isShareMomentType(row.type)) return null
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? (row.payload as unknown as ShareMomentPayload) : null
  if (!payload || typeof payload.displayName !== 'string') return null
  return {
    id: row.id,
    leagueId: row.leagueId,
    type: row.type,
    week: row.week,
    subjectUserId: row.subjectUserId,
    subjectRosterId: row.subjectRosterId,
    payload,
    final: row.final,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  }
}

/** League slugs do not exist in this schema, so the `[leagueSlug]` segment carries the league id. */
export function shareMomentPagePath(moment: Pick<ShareMomentRecord, 'id' | 'leagueId'>): string {
  return `/l/${encodeURIComponent(moment.leagueId)}/moment/${encodeURIComponent(moment.id)}`
}

export function shareMomentImagePath(momentId: string, format: ShareCardFormat): string {
  return `/api/share/survivor/${encodeURIComponent(momentId)}?f=${format}`
}

export function absoluteSiteUrl(path: string): string {
  return `${getPublicSiteOrigin().replace(/\/$/, '')}${path}`
}

export async function readShareCardsEnabled(leagueId: string): Promise<boolean> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return false
  const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
  return normalizeSurvivorFoundationSettings(settings).shareCardsEnabled
}

export async function getShareMoment(momentId: string): Promise<ShareMomentRecord | null> {
  if (!momentId || momentId.length > 64) return null
  try {
    const row = await prisma.survivorShareMoment.findUnique({ where: { id: momentId } })
    return row ? toShareMomentRecord(row) : null
  } catch (error) {
    if (isMissingTable(error)) return null
    throw error
  }
}

/**
 * The moment behind a public moment page, or null (→ 404) when the id is unknown, the page is
 * addressed under the wrong league, sharing is off for the league, or the moment is not public.
 */
export async function loadPublicShareMoment(leagueSlug: string, momentId: string): Promise<ShareMomentRecord | null> {
  const moment = await getShareMoment(momentId)
  if (!moment || moment.leagueId !== leagueSlug) return null
  const enabled = await readShareCardsEnabled(moment.leagueId)
  return isMomentPublic(moment, enabled) ? moment : null
}

export interface NewShareMoment {
  leagueId: string
  type: ShareMomentType
  week: number
  subjectUserId: string
  subjectRosterId?: string | null
  dedupeKey: string
  payload: ShareMomentPayload
}

/** Idempotent: the first capture wins and later captures of the same event are no-ops. */
export async function createShareMomentOnce(input: NewShareMoment): Promise<{ created: boolean; id: string | null }> {
  try {
    const existing = await prisma.survivorShareMoment.findUnique({
      where: { leagueId_dedupeKey: { leagueId: input.leagueId, dedupeKey: input.dedupeKey } },
      select: { id: true },
    })
    if (existing) return { created: false, id: existing.id }
    const row = await prisma.survivorShareMoment.create({
      data: {
        leagueId: input.leagueId,
        type: input.type,
        week: input.week,
        subjectUserId: input.subjectUserId,
        subjectRosterId: input.subjectRosterId ?? null,
        dedupeKey: input.dedupeKey,
        payload: input.payload as unknown as Prisma.InputJsonValue,
        final: true,
      },
      select: { id: true },
    })
    return { created: true, id: row.id }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === 'P2002') return { created: false, id: null }
    if (isMissingTable(error)) return { created: false, id: null }
    throw error
  }
}

export async function countImmunityMoments(leagueId: string, subjectUserId: string): Promise<number> {
  try {
    return await prisma.survivorShareMoment.count({ where: { leagueId, subjectUserId, type: 'immunity' } })
  } catch (error) {
    if (isMissingTable(error)) return 0
    throw error
  }
}

export function toListItem(moment: ShareMomentRecord, viewerUserId: string | null): ShareMomentListItem {
  const content = buildShareCardContent(moment.type, moment.week, moment.payload)
  return {
    id: moment.id,
    type: moment.type,
    week: moment.week,
    title: SHARE_MOMENT_TITLES[moment.type],
    subtitle: `Week ${moment.week}`,
    iconPath: shareIconPath(moment.type, moment.payload),
    headline: content.headline,
    offeredNote: SHARE_MOMENT_OFFERED[moment.type],
    published: moment.publishedAt != null,
    pageUrl: absoluteSiteUrl(shareMomentPagePath(moment)),
    imageUrl: {
      post: shareMomentImagePath(moment.id, 'post'),
      story: shareMomentImagePath(moment.id, 'story'),
      link: shareMomentImagePath(moment.id, 'link'),
    },
    isSubject: viewerUserId === moment.subjectUserId,
  }
}

/** The moments this viewer may share in this league, newest first. */
export async function listOfferedMoments(leagueId: string, viewer: ViewerFacts): Promise<ShareMomentRecord[]> {
  if (!viewer.userId) return []
  try {
    const rows = await prisma.survivorShareMoment.findMany({
      where: { leagueId, final: true, OR: [{ subjectUserId: viewer.userId }, { type: 'champ' }] },
      orderBy: [{ week: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    })
    return rows
      .map(toShareMomentRecord)
      .filter((moment): moment is ShareMomentRecord => moment != null && isMomentOfferedTo(moment, viewer))
  } catch (error) {
    if (isMissingTable(error)) return []
    throw error
  }
}

/** Make a moment public (moment page + immutable images). Only someone it is offered to may. */
export async function publishShareMoment(moment: ShareMomentRecord, viewer: ViewerFacts): Promise<ShareMomentRecord | null> {
  if (!canPublishMoment(moment, viewer)) return null
  if (moment.publishedAt) return moment
  const publishedAt = new Date()
  await prisma.survivorShareMoment.updateMany({ where: { id: moment.id, publishedAt: null }, data: { publishedAt, publishedBy: viewer.userId } })
  return { ...moment, publishedAt }
}

/**
 * Post the card into the league's Survivor chat as a system message. The message carries the
 * public page URL and the link image; nothing in it is beyond what the card already shows.
 */
export async function postShareMomentToLeagueChat(moment: ShareMomentRecord, sharerName: string): Promise<{ ok: boolean; error?: string }> {
  const channel = await prisma.survivorChatChannel.findFirst({
    where: { leagueId: moment.leagueId, channelType: 'league', isArchived: false },
    select: { id: true },
  })
  if (!channel) return { ok: false, error: 'League chat is not ready yet.' }
  const content = buildShareCardContent(moment.type, moment.week, moment.payload)
  const pageUrl = absoluteSiteUrl(shareMomentPagePath(moment))
  await createSurvivorChatMessage(prisma, {
    data: {
      leagueId: moment.leagueId,
      channelId: channel.id,
      channelType: 'league',
      senderUserId: 'survivor-host-chimmy',
      senderName: 'Chimmy',
      senderIsHost: true,
      isSystemMessage: true,
      contentType: 'card',
      content: `${sharerName} shared a card: ${content.headline}\n${pageUrl}`,
      cardData: {
        type: 'share_card',
        momentId: moment.id,
        momentType: moment.type,
        headline: content.headline,
        kicker: content.kicker,
        pageUrl,
        imageUrl: absoluteSiteUrl(shareMomentImagePath(moment.id, 'link')),
      },
    },
  })
  return { ok: true }
}
