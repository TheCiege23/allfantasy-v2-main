import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { createAfLeagueTrade, listAfLeagueTrades } from '@/lib/league-trade-engine/tradeService'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import { prisma } from '@/lib/prisma'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedTradeIntegrationService, extractTradePlayerRefs, type TradeSafety } from '@/lib/fantasy-os/sports-runtime/tradeIntegration'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'

export const dynamic = 'force-dynamic'

type TradeSportsDecision = { featureGateEnabled: boolean; finalDecision: 'allowed' | 'rejected'; reason: string; freshnessStatus: string; identityStatus: string; scheduleSnapshotVersion: string | null; startedCanonicalPlayerIds: string[]; policyObserved: string; evaluatedAt: string }

/** Build a safe, emit-only decision envelope from a reject-only trade guard result. */
function toTradeDecision(g: TradeSafety): TradeSportsDecision {
  return { featureGateEnabled: true, finalDecision: g.block ? 'rejected' : 'allowed', reason: g.reason, freshnessStatus: g.freshnessStatus, identityStatus: g.identityStatus, scheduleSnapshotVersion: g.snapshotVersion, startedCanonicalPlayerIds: g.startedPlayers, policyObserved: g.policyObserved, evaluatedAt: new Date().toISOString() }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const trades = await listAfLeagueTrades(leagueId, { take: 100 })
  return NextResponse.json({ trades })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const body = (await req.json().catch(() => ({}))) as {
    proposerRosterId?: string
    receiverRosterId?: string
    assets?: TradeAssetInput[]
    parentTradeId?: string | null
    expiresInHours?: number
    metadata?: Record<string, unknown>
    currentWeek?: number | null
    vetoMode?: unknown
    vetoThreshold?: unknown
    reviewWindow?: unknown
    tradeDeadline?: unknown
    maxAssets?: unknown
    processingMode?: unknown
    commissionerApproval?: unknown
    allowDraftPicks?: unknown
  }

  const prohibited = ['vetoMode', 'vetoThreshold', 'reviewWindow', 'tradeDeadline', 'maxAssets', 'processingMode', 'commissionerApproval', 'allowDraftPicks']
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
  if (prohibited.length) {
    return NextResponse.json({ error: 'Trade governance is controlled by persisted league settings.', prohibitedFields: prohibited }, { status: 400 })
  }

  if (!body.proposerRosterId || !body.receiverRosterId || !Array.isArray(body.assets)) {
    return NextResponse.json({ error: 'proposerRosterId, receiverRosterId, assets required' }, { status: 400 })
  }

  // Gated, reject-only certified sports safety — runs BEFORE createAfLeagueTrade (the authoritative validate +
  // persist). It emits evidence and can only ADD a rejection; it NEVER changes valuation, fairness, legality,
  // ownership, deadline, or roster reconstruction. enforcePlayerLock is FALSE because the trade engine does not
  // enforce the declared individual_game_time policy — so this never invents a rejection. Wrapped so it can
  // never turn a valid proposal into an error.
  let sportsDataDecision: TradeSportsDecision | undefined
  if (isSportsDataEnabled('trade')) {
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
      if (league && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
        const refs = extractTradePlayerRefs(body.assets.map((a) => ({ itemType: a.itemType, itemReference: a.itemReference })))
        const guard = await new CertifiedTradeIntegrationService().evaluateTradeProposalSafety({
          season: String(league.season ?? new Date().getFullYear()),
          week: String(weekFromLeagueSettingsForLineup(league.settings)),
          players: refs,
          enforcePlayerLock: false,
        })
        sportsDataDecision = toTradeDecision(guard)
        if (guard.block) {
          return NextResponse.json({ error: `Trade blocked by certified game evidence: ${guard.reason}`, code: 'SPORTS_DATA_LOCK', sportsDataDecision }, { status: 409 })
        }
      }
    } catch {
      sportsDataDecision = undefined
    }
  }

  try {
    /**
     * `governance` was destructured here but `createAfLeagueTrade` returns
     * `Promise<{ id: string }>` and never computes it — the word does not appear
     * anywhere in tradeService.ts. So the value was always `undefined`, and
     * JSON.stringify dropped the key: this endpoint has never once returned a
     * `governance` field. Removing the dead expectation rather than inventing a
     * payload for it. Echoing effective governance back on create is a
     * reasonable feature (see the prohibited-fields guard above, which already
     * treats governance as league-settings-owned) but it has to be built
     * deliberately, not faked to satisfy a destructure.
     */
    const { id } = await createAfLeagueTrade({
      leagueId,
      proposedByUserId: userId,
      proposerRosterId: body.proposerRosterId,
      receiverRosterId: body.receiverRosterId,
      assets: body.assets,
      parentTradeId: body.parentTradeId ?? null,
      expiresInHours: body.expiresInHours,
      metadata: body.metadata,
    })
    return NextResponse.json({ ok: true, tradeId: id, ...(sportsDataDecision ? { sportsDataDecision } : {}) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
