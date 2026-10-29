import 'server-only'
import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { resolveTribeEmblem } from '@/lib/survivor/survivorTribeIdentity'
import { stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { buildShareCardContent } from './cardContent'
import { isMomentPublic } from './momentAccess'
import { getShareMoment, shareMomentPagePath, toShareMomentRecord } from './momentStore'
import { momentCouncilIdFromDedupeKey, publicMomentScroll, type MomentMoreItem, type MomentScrollSlip, type MomentTribeTorches } from './momentPageModel'
import type { ShareMomentRecord } from './types'

/**
 * Everything the public moment page shows (survivor-core §4), or a reason it shows nothing.
 *
 *  - `null` → 404, exactly as before: unknown id, wrong league in the URL, share cards off for the
 *    league, or the moment is not final and published (share-cards privacy rules, momentAccess).
 *  - `{ state: 'private' }` → the league turned public moment pages off. Carries nothing about the
 *    moment, so the private page cannot leak it.
 *  - `{ state: 'public', ... }` → display names, the public scroll, torch counts and three more
 *    public moments from the same league.
 */
export type MomentPageData =
  | { state: 'private' }
  | {
    state: 'public'
    moment: ShareMomentRecord
    scroll: { week: number; slips: MomentScrollSlip[] } | null
    tribes: MomentTribeTorches[]
    more: MomentMoreItem[]
  }

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'P2021' || code === 'P2022'
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isMissingTable(error)) return fallback
    throw error
  }
}

const OUT_STATES = ['eliminated', 'exile', 'jury', 'voted_out']

export async function loadMomentPageData(leagueSlug: string, momentId: string, opts: { now?: Date; details?: boolean } = {}): Promise<MomentPageData | null> {
  const now = opts.now ?? new Date()
  const moment = await getShareMoment(momentId)
  if (!moment || moment.leagueId !== leagueSlug) return null
  const league = await prisma.league.findUnique({ where: { id: moment.leagueId }, select: { settings: true, sport: true, survivorRevealMode: true } })
  if (!league) return null
  const settings = normalizeSurvivorFoundationSettings(league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {})
  if (!isMomentPublic(moment, settings.shareCardsEnabled)) return null
  if (!settings.publicMomentPages) return { state: 'private' }
  if (opts.details === false) return { state: 'public', moment, scroll: null, tribes: [], more: [] }

  const [scroll, tribes, more] = await Promise.all([
    loadScroll(moment, league.survivorRevealMode, now),
    loadTorches(moment.leagueId, String(league.sport)),
    loadMore(moment),
  ])
  return { state: 'public', moment, scroll, tribes, more }
}

async function loadScroll(moment: ShareMomentRecord, revealMode: string | null, now: Date) {
  if (moment.type !== 'out' && moment.type !== 'idol') return null
  const row = await safe(() => prisma.survivorShareMoment.findUnique({ where: { id: moment.id }, select: { dedupeKey: true } }), null)
  const councilId = momentCouncilIdFromDedupeKey(row?.dedupeKey)
  if (!councilId) return null
  const council = await safe(() => prisma.survivorTribalCouncil.findUnique({
    where: { id: councilId },
    // Deliberately no votes relation and no voter columns.
    select: { leagueId: true, week: true, isRevealed: true, revealStartsAt: true, revealStep: true, revealSequence: true },
  }), null)
  if (!council || council.leagueId !== moment.leagueId) return null
  return publicMomentScroll(council, revealMode, now)
}

async function loadTorches(leagueId: string, sport: string): Promise<MomentTribeTorches[]> {
  const tribes = await safe(() => prisma.survivorTribe.findMany({
    where: { leagueId, isActive: true },
    orderBy: { slotIndex: 'asc' },
    select: { id: true, name: true, isMerged: true, colorHex: true, logoUrl: true, catalogId: true, primaryColor: true, secondaryColor: true, _count: { select: { members: true } } },
  }), [])
  const merged = tribes.find(t => t.isMerged)
  const shown = merged ? [merged] : tribes
  if (!shown.length) return []
  const outRows = await safe(() => prisma.survivorPlayer.groupBy({
    by: ['tribeId'],
    where: { leagueId, tribeId: { in: shown.map(t => t.id) }, playerState: { in: OUT_STATES } },
    _count: { _all: true },
  }), [] as { tribeId: string | null; _count: { _all: number } }[])
  const outBy = new Map(outRows.map(r => [r.tribeId, r._count._all]))
  return shown.map(t => {
    const name = stripLeadingTribeIcon(t.name) || t.name
    return {
      name,
      crestUrl: resolveTribeEmblem({ name, logoUrl: t.logoUrl, catalogId: t.catalogId, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor }, sport).crestUrl,
      color: t.colorHex,
      lit: t._count.members,
      out: outBy.get(t.id) ?? 0,
    }
  })
}

async function loadMore(moment: ShareMomentRecord): Promise<MomentMoreItem[]> {
  const rows = await safe(() => prisma.survivorShareMoment.findMany({
    where: { leagueId: moment.leagueId, final: true, publishedAt: { not: null }, NOT: { id: moment.id } },
    orderBy: [{ week: 'desc' }, { createdAt: 'desc' }],
    take: 3,
  }), [])
  return rows
    .map(toShareMomentRecord)
    .filter((m): m is ShareMomentRecord => m != null)
    .map(m => {
      const content = buildShareCardContent(m.type, m.week, m.payload)
      return { href: shareMomentPagePath(m), kicker: content.kicker, headline: content.headline, backgroundPath: content.backgroundPath, heroPath: content.heroPath, accent: content.theme.accent }
    })
}
