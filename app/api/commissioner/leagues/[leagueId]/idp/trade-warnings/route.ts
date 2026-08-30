/**
 * GET: Pending trades in this league that would leave a side unable to field a legal IDP lineup.
 * Commissioner only.
 *
 * This used to return a prose string telling the caller to go run POST /api/trade-evaluator
 * themselves, after doing a session check, a commissioner check and an isIdpLeague read — an
 * auth-gated piece of documentation. A commissioner reviewing a queue cannot re-run an
 * evaluator per trade by hand, which is the whole reason the endpoint exists.
 *
 * 🛑 IT DELIBERATELY REUSES THE EVALUATOR'S OWN HELPERS. getTotalIdpStarterSlots,
 * postTradePositions and canFieldLegalIdpLineup are the same functions
 * /api/trade-evaluator calls to build idpLineupWarning. Reimplementing the eligibility rule
 * here would let the commissioner view and the trade evaluator disagree about whether the
 * SAME trade is legal — the worst possible outcome for a screen whose only job is to be the
 * authority on that question.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { isIdpLeague } from '@/lib/idp'
import {
  getTotalIdpStarterSlots,
  postTradePositions,
  canFieldLegalIdpLineup,
} from '@/lib/trade-engine/idp-lineup-check'

type RosterEntry = { name?: string; position?: string }

/** Roster.playerData is untyped JSON; positions appear as `position` or `pos`. */
function parseRoster(playerData: unknown): RosterEntry[] {
  if (!Array.isArray(playerData)) return []
  return playerData.map((p: any) => ({
    name: String(p?.name ?? p?.full_name ?? p?.playerName ?? '').trim(),
    position: String(p?.position ?? p?.pos ?? '').trim().toUpperCase() || undefined,
  }))
}

function itemName(item: any): string {
  const meta = item?.metadata ?? {}
  return String(meta?.name ?? meta?.playerName ?? item?.itemReference ?? '').trim()
}

function itemPosition(item: any): string | null {
  const meta = item?.metadata ?? {}
  const pos = String(meta?.position ?? meta?.pos ?? '').trim().toUpperCase()
  return pos || null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await assertCommissioner(leagueId, session.user.id)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const requiredIdp = await getTotalIdpStarterSlots(leagueId)
  /*
   * ⚠ A league with no IDP starter slots is not "no warnings" — it is a league where the
   * question does not apply, and canFieldLegalIdpLineup returns true for everything. Saying
   * so explicitly stops a commissioner reading an empty list as "all trades are safe".
   */
  if (requiredIdp <= 0) {
    return NextResponse.json({
      leagueId,
      requiredIdpStarterSlots: 0,
      applicable: false,
      reason: 'This league has no IDP starter slots, so no trade can break an IDP lineup.',
      pendingTradesChecked: 0,
      warnings: [],
    })
  }

  const { prisma } = await import('@/lib/prisma')

  const trades = await (prisma as any).afLeagueTrade.findMany({
    where: { leagueId, status: 'pending' },
    select: {
      id: true,
      proposerRosterId: true,
      receiverRosterId: true,
      createdAt: true,
      expiresAt: true,
      items: {
        select: { itemType: true, itemReference: true, fromRosterId: true, toRosterId: true, metadata: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!trades.length) {
    return NextResponse.json({
      leagueId,
      requiredIdpStarterSlots: requiredIdp,
      applicable: true,
      pendingTradesChecked: 0,
      warnings: [],
    })
  }

  const rosterIds = Array.from(
    new Set(trades.flatMap((t: any) => [t.proposerRosterId, t.receiverRosterId]).filter(Boolean))
  )
  const rosters = await (prisma as any).roster.findMany({
    where: { id: { in: rosterIds }, leagueId },
    select: { id: true, playerData: true },
  })
  const rosterById = new Map<string, RosterEntry[]>(
    rosters.map((r: any) => [r.id, parseRoster(r.playerData)])
  )

  const warnings: Array<Record<string, unknown>> = []
  let checked = 0

  for (const trade of trades) {
    const playerItems = (trade.items ?? []).filter((i: any) => i?.itemType === 'player')
    /*
     * A trade of picks and FAAB only cannot change either side's IDP eligibility, so it is
     * not "checked and clean" — there is nothing to check. Skipping it keeps the
     * pendingTradesChecked count honest.
     */
    if (!playerItems.length) continue

    const sides = [
      { label: 'Proposer', rosterId: trade.proposerRosterId },
      { label: 'Receiver', rosterId: trade.receiverRosterId },
    ]

    const offending: Array<{ side: string; idpAfter: number }> = []
    let evaluable = true

    for (const side of sides) {
      const roster = rosterById.get(side.rosterId)
      // No roster row means we cannot answer for this trade; do not guess a verdict.
      if (!roster) { evaluable = false; break }

      const givenNames = playerItems
        .filter((i: any) => i.fromRosterId === side.rosterId)
        .map(itemName)
        .filter(Boolean)
      const receivedPositions = playerItems
        .filter((i: any) => i.toRosterId === side.rosterId)
        .map(itemPosition)

      const after = postTradePositions(roster, givenNames, receivedPositions)
      if (!canFieldLegalIdpLineup(after, requiredIdp)) {
        offending.push({
          side: side.label,
          idpAfter: after.filter((p) => p && ['DE', 'DT', 'LB', 'CB', 'S', 'SS', 'FS'].includes(p)).length,
        })
      }
    }

    if (!evaluable) continue
    checked++

    if (offending.length) {
      const who = offending.map((o) => o.side)
      warnings.push({
        tradeId: trade.id,
        createdAt: trade.createdAt,
        expiresAt: trade.expiresAt,
        sides: who,
        requiredIdpStarterSlots: requiredIdp,
        idpAfterBySide: Object.fromEntries(offending.map((o) => [o.side, o.idpAfter])),
        message: `After this trade, ${who.join(' and ')} would not have enough IDP-eligible players to field a legal lineup (${requiredIdp} IDP starter slots required).`,
      })
    }
  }

  return NextResponse.json({
    leagueId,
    requiredIdpStarterSlots: requiredIdp,
    applicable: true,
    pendingTradesChecked: checked,
    warnings,
  })
}
