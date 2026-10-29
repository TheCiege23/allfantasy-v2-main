import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasLeagueCommissionerRights } from '@/lib/league/permissions'
import { assertLeagueMember } from '@/lib/league/league-access'
import { computeAdaptiveValuePreview, type PreviewObservation } from '@/lib/trade-market/redraftAdaptiveValuePreview'

export const dynamic = 'force-dynamic'

/** Owner, team commissioner / co-commissioner, or tournament co-commissioner (no team needed). */
function isCommissionerOrOwner(leagueId: string, userId: string): Promise<boolean> {
  return hasLeagueCommissionerRights(leagueId, userId)
}

function mapTerminal(status: string): PreviewObservation['terminal'] {
  if (status === 'accepted' || status === 'processed') return 'accepted'
  if (status === 'rejected') return 'rejected'
  if (status === 'vetoed') return 'vetoed'
  if (status === 'cancelled' || status === 'canceled') return 'canceled'
  if (status === 'expired') return 'expired'
  return 'pending'
}

type SnapshotAsset = { playerId?: string | null; playerName?: string | null; position?: string | null; internalValue?: number | null }
type LeagueProposal = {
  status: string
  createdAt: Date
  assets: Array<{ assetType: string; playerId: string | null; playerName: string | null; metadata: unknown }>
  valueSnapshot: { confidenceScore: number; payload: unknown } | null
}

/** Build per-player observations from the league's proposals (T2 snapshot values + lifecycle terminal). */
function observationsByPlayer(proposals: LeagueProposal[]): Map<string, { name: string | null; position: string | null; observations: PreviewObservation[] }> {
  const byPlayer = new Map<string, { name: string | null; position: string | null; observations: PreviewObservation[] }>()
  for (const p of proposals) {
    const terminal = mapTerminal(p.status)
    const snapAssets = ((p.valueSnapshot?.payload ?? null) as { sides?: Array<{ assets?: SnapshotAsset[] }> } | null)?.sides?.flatMap((s) => s.assets ?? []) ?? []
    const valueByPlayer = new Map<string, SnapshotAsset>()
    for (const a of snapAssets) if (a.playerId) valueByPlayer.set(a.playerId, a)

    for (const a of p.assets) {
      if (a.assetType !== 'player' || !a.playerId) continue
      const snap = valueByPlayer.get(a.playerId)
      const md = (a.metadata ?? {}) as Record<string, unknown>
      let entry = byPlayer.get(a.playerId)
      if (!entry) {
        entry = {
          name: a.playerName ?? snap?.playerName ?? null,
          position: snap?.position ?? (typeof md.position === 'string' ? md.position : null),
          observations: [],
        }
        byPlayer.set(a.playerId, entry)
      }
      entry.observations.push({
        terminal,
        observedValue: typeof snap?.internalValue === 'number' ? snap.internalValue : null,
        confidenceScore: p.valueSnapshot?.confidenceScore ?? null,
        createdAt: p.createdAt,
      })
    }
  }
  return byPlayer
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const playerId = req.nextUrl.searchParams?.get('playerId')?.trim()
  const topMovers = req.nextUrl.searchParams?.get('topMovers') === '1'
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!playerId && !topMovers) return NextResponse.json({ error: 'playerId or topMovers required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  if (!(await isCommissionerOrOwner(leagueId, userId))) {
    return NextResponse.json({ error: 'Commissioner or co-commissioner permission required' }, { status: 403 })
  }

  const proposals = (await prisma.redraftTradeProposal.findMany({
    where: { leagueId },
    select: {
      status: true,
      createdAt: true,
      assets: { select: { assetType: true, playerId: true, playerName: true, metadata: true } },
      valueSnapshot: { select: { confidenceScore: true, payload: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })) as unknown as LeagueProposal[]

  const byPlayer = observationsByPlayer(proposals)

  if (playerId) {
    const entry = byPlayer.get(playerId)
    if (!entry) {
      // Safe empty output — player not seen in any trade.
      return NextResponse.json({
        preview: computeAdaptiveValuePreview({ playerId, observations: [] }),
        generatedAt: new Date().toISOString(),
      })
    }
    return NextResponse.json({
      preview: computeAdaptiveValuePreview({ playerId, playerName: entry.name, position: entry.position, observations: entry.observations }),
      generatedAt: new Date().toISOString(),
    })
  }

  // topMovers: previews for all players with enough sample, sorted by |adjustment|.
  const previews = [...byPlayer.entries()]
    .map(([pid, e]) => computeAdaptiveValuePreview({ playerId: pid, playerName: e.name, position: e.position, observations: e.observations }))
    .filter((p) => p.direction !== 'insufficient')
    .sort((a, b) => Math.abs(b.adjustmentPercent) - Math.abs(a.adjustmentPercent))
    .slice(0, 10)

  return NextResponse.json({ topMovers: previews, generatedAt: new Date().toISOString() })
}
