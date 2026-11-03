import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export type RosterDraftPickRow = {
  id: string
  season: number
  round: number
  slotNumber: number
  pickNumber: number
  label: string
  status: string
  /** traded_to / traded_from / received — from metadata or trade engine */
  tradeHint?: 'received' | 'traded_away' | 'owned' | null
  counterpartyName?: string | null
  draftStatus?: string | null
}

function labelFromPick(p: {
  round: number
  slotNumber: number
  pickNumber: number
  metadata: unknown
  draft: { season: number }
}): { label: string; tradeHint?: RosterDraftPickRow['tradeHint']; counterparty?: string | null } {
  const meta =
    p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
      ? (p.metadata as Record<string, unknown>)
      : {}
  const tradedTo = typeof meta.tradedToName === 'string' ? meta.tradedToName : null
  const tradedFrom = typeof meta.tradedFromName === 'string' ? meta.tradedFromName : null
  const receivedFrom = typeof meta.receivedFromName === 'string' ? meta.receivedFromName : null
  const orderFinal = meta.orderFinal === true || meta.orderIsFinal === true
  const slotLabel = `${p.round}.${String(p.slotNumber).padStart(2, '0')}`
  const base = `${p.draft.season} ${slotLabel}${orderFinal ? '' : ' (proj.)'}`

  if (receivedFrom) {
    return { label: `${base} received from ${receivedFrom}`, tradeHint: 'received', counterparty: receivedFrom }
  }
  if (tradedTo) {
    return { label: `${base} traded to ${tradedTo}`, tradeHint: 'traded_away', counterparty: tradedTo }
  }
  if (tradedFrom) {
    return { label: `${base} from ${tradedFrom}`, tradeHint: 'received', counterparty: tradedFrom }
  }

  return { label: `${p.draft.season} Round ${p.round} · slot ${p.slotNumber}`, tradeHint: 'owned' }
}

export type DraftPickTradeLink = {
  tradeId: string
  status: string
  createdAt: string
  proposerRosterId: string
  receiverRosterId: string
  summary: string
}

/**
 * GET: future / pending redraft draft picks for the caller's roster in this league (+ JSON fallbacks).
 * Optional `?pickId=` returns one pick plus `af_league_trades` rows whose items reference that pick id.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const coOwnerRosterId = await acceptedCoOwnerRosterId(leagueId, userId)
  const pickId = req.nextUrl.searchParams.get('pickId')?.trim() ?? null

  const roster = await prisma.roster.findFirst({
    where: coOwnerRosterId ? { leagueId, id: coOwnerRosterId } : { leagueId, platformUserId: userId },
  })
  if (!roster) {
    return NextResponse.json({ error: 'No roster for this user in this league.' }, { status: 404 })
  }

  const redraftPicks = await prisma.redraftDraftPick.findMany({
    where: { leagueId, rosterId: roster.id },
    include: {
      draft: { select: { season: true, status: true } },
    },
    orderBy: [{ round: 'asc' }, { pickNumber: 'asc' }],
    take: 80,
  })

  const rows: RosterDraftPickRow[] = redraftPicks.map((p) => {
    const { label, tradeHint, counterparty } = labelFromPick({
      round: p.round,
      slotNumber: p.slotNumber,
      pickNumber: p.pickNumber,
      metadata: p.metadata,
      draft: { season: p.draft.season },
    })
    return {
      id: p.id,
      season: p.draft.season,
      round: p.round,
      slotNumber: p.slotNumber,
      pickNumber: p.pickNumber,
      label,
      status: p.status,
      tradeHint: tradeHint ?? null,
      counterpartyName: counterparty ?? null,
      draftStatus: p.draft.status ?? null,
    }
  })

  const playerData = roster.playerData as Record<string, unknown> | null | undefined
  const fallbackPicks: unknown[] = Array.isArray(playerData?.picks)
    ? (playerData!.picks as unknown[])
    : Array.isArray(playerData?.draft_picks)
      ? (playerData!.draft_picks as unknown[])
      : []

  let tradeChain: DraftPickTradeLink[] | undefined
  let pickDetail: RosterDraftPickRow | null = null

  if (pickId) {
    pickDetail = rows.find((r) => r.id === pickId) ?? null
    const trades = await prisma.afLeagueTrade.findMany({
      where: {
        leagueId,
        items: { some: { itemReference: pickId } },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        proposerRosterId: true,
        receiverRosterId: true,
        items: {
          where: { itemReference: pickId },
          select: { itemType: true, itemReference: true, fromRosterId: true, toRosterId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })
    tradeChain = trades.map((t) => {
      const it = t.items[0]
      const summary = it
        ? `${it.itemType}${it.itemReference ? ` · ${it.itemReference}` : ''} (${it.fromRosterId.slice(0, 6)}…→${it.toRosterId.slice(0, 6)}…)`
        : 'Draft asset'
      return {
        tradeId: t.id,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        proposerRosterId: t.proposerRosterId,
        receiverRosterId: t.receiverRosterId,
        summary,
      }
    })
  }

  return NextResponse.json({
    ok: true,
    rosterId: roster.id,
    picks: rows,
    fallbackPicks,
    ...(pickId
      ? {
          pickId,
          pick: pickDetail,
          tradeChain: tradeChain ?? [],
        }
      : {}),
  })
}
