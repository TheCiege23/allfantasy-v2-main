import 'server-only'

import { prisma } from '@/lib/prisma'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { getDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { checkDynastyLotteryEligibility } from '@/lib/draft-lottery/dynastyYearGuard'
import { normalizeToSupportedSport, DEFAULT_SPORT } from '@/lib/sport-scope'

export type WeightedLotterySlotEntry = { slot: number; rosterId: string; displayName: string }

/**
 * When dynasty rookie order is weighted lottery and a prior run is stored, use that slot order
 * for new draft sessions. Never applies on startup / year-1 leagues (guard).
 */
export async function resolveWeightedLotterySlotOrderForLeague(
  leagueId: string
): Promise<WeightedLotterySlotEntry[] | null> {
  const eligibility = await checkDynastyLotteryEligibility(leagueId)
  if (!eligibility.eligible) return null

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      isDynasty: true,
      leagueVariant: true,
      settings: true,
      dynastyConfig: { select: { rookiePickOrderMethod: true } },
    },
  })
  if (!league) return null

  const isDynasty =
    league.isDynasty ||
    (league.leagueVariant != null &&
      ['devy_dynasty', 'merged_devy_c2c'].includes(String(league.leagueVariant).toLowerCase()))
  if (!isDynasty) return null
  if (league.dynastyConfig?.rookiePickOrderMethod !== 'weighted_lottery') return null

  const { lotteryLastResult } = await getDraftOrderModeAndLotteryConfig(leagueId)
  const order = lotteryLastResult?.slotOrder
  if (!Array.isArray(order) || order.length === 0) return null

  return order.map((e) => ({
    slot: Number(e.slot),
    rosterId: String(e.rosterId),
    displayName: String(e.displayName ?? ''),
  }))
}

export type DraftRouteType = 'snake' | 'auction' | 'lottery'

export type LiveDraftRouteContext = {
  kind: 'live'
  draftId: string
  leagueId: string
  leagueName: string
  sport: string
  isDynasty: boolean
  isCommissioner: boolean
  formatType?: string
  routeType: DraftRouteType
  draftType: string
  status: string
}

export type MockDraftRouteContext = {
  kind: 'mock'
  draftId: string
  sport: string
  leagueName: string
  routeType: 'snake'
  draftType: string
  status: string
}

export type DraftRouteContext = LiveDraftRouteContext | MockDraftRouteContext

function parseMockMetadata(raw: unknown) {
  const metadata = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    sport: normalizeToSupportedSport(String(metadata.sport ?? DEFAULT_SPORT)),
    draftType: String(metadata.draftType ?? 'snake').toLowerCase(),
    leagueName: String(metadata.name ?? metadata.leagueName ?? 'Mock Draft'),
  }
}

export async function resolveLiveDraftContextByDraftId(
  draftId: string,
  userId?: string
): Promise<LiveDraftRouteContext | null> {
  const session = await prisma.draftSession.findUnique({
    where: { id: draftId },
    include: {
      league: {
        select: {
          id: true,
          name: true,
          sport: true,
          isDynasty: true,
          leagueVariant: true,
        },
      },
    },
  })

  console.warn('[resolve-draft-context:live] lookup', {
    draftId,
    session_found: session !== null,
    session_id: session?.id ?? null,
    session_leagueId: session?.leagueId ?? null,
    league_present: session?.league != null,
    league_id: session?.league?.id ?? null,
    session_status: session?.status ?? null,
    session_draftType: session?.draftType ?? null,
  })

  // When the Prisma join returns null (e.g. broken FK, data inconsistency in prod),
  // fall back to a direct league lookup — mirrors what the session API does.
  let resolvedLeague = session?.league ?? null
  if (session && !resolvedLeague?.id && session.leagueId) {
    console.warn('[resolve-draft-context:live] league join null — falling back to direct lookup', {
      draftId,
      leagueId: session.leagueId,
    })
    resolvedLeague = await prisma.league.findUnique({
      where: { id: session.leagueId },
      select: { id: true, name: true, sport: true, isDynasty: true, leagueVariant: true },
    })
  }

  if (!session || !resolvedLeague?.id) {
    console.warn('[resolve-draft-context:live] returning null — session or league missing', {
      draftId,
      session_null: session === null,
      league_null: session !== null && resolvedLeague === null,
      league_id_falsy: resolvedLeague != null && !resolvedLeague.id,
    })
    return null
  }

  const orderMode = await getDraftOrderModeAndLotteryConfig(resolvedLeague.id).catch(() => null)
  const variant = String(resolvedLeague.leagueVariant ?? '').toUpperCase()
  const formatType = variant === 'IDP' || variant === 'DYNASTY_IDP' ? 'IDP' : undefined
  const routeType: DraftRouteType =
    session.draftType === 'auction'
      ? 'auction'
      : orderMode?.draftOrderMode === 'weighted_lottery' && session.status === 'pre_draft'
        ? 'lottery'
        : 'snake'

  return {
    kind: 'live',
    draftId: session.id,
    leagueId: resolvedLeague.id,
    leagueName: resolvedLeague.name ?? 'League Draft',
    sport: normalizeToSupportedSport(String(resolvedLeague.sport ?? session.sportType ?? DEFAULT_SPORT)),
    isDynasty: Boolean(resolvedLeague.isDynasty),
    isCommissioner: userId ? await isCommissioner(resolvedLeague.id, userId).catch(() => false) : false,
    formatType,
    routeType,
    draftType: String(session.draftType ?? 'snake'),
    status: String(session.status ?? 'pre_draft'),
  }
}

export async function resolveDraftRouteContext(
  draftId: string,
  userId?: string
): Promise<DraftRouteContext | null> {
  const live = await resolveLiveDraftContextByDraftId(draftId, userId)
  if (live) return live

  const mockDraft = await prisma.mockDraft.findUnique({
    where: { id: draftId },
    select: { id: true, status: true, metadata: true },
  })

  if (!mockDraft?.id) {
    return null
  }

  const mock = parseMockMetadata(mockDraft.metadata)
  return {
    kind: 'mock',
    draftId: mockDraft.id,
    sport: mock.sport,
    leagueName: mock.leagueName,
    routeType: 'snake',
    draftType: mock.draftType,
    status: String(mockDraft.status ?? 'pre_draft'),
  }
}

export async function assertLiveDraftContext(
  draftId: string,
  userId?: string
): Promise<LiveDraftRouteContext> {
  const context = await resolveLiveDraftContextByDraftId(draftId, userId)
  if (!context) {
    throw new Error('Live draft not found')
  }
  return context
}
