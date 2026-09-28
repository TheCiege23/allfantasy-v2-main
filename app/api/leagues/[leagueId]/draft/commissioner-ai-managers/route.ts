import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import {
  buildApiResponse,
  getBlobForLeague,
  parseCommissionerAiManagers,
  saveCommissionerAiManagers,
  validateAndMergeAssignments,
  type CommissionerAiAssignment,
} from '@/lib/commissioner-ai-draft-manager'
import {
  CommissionerTradeRulesSchema,
  AiStyleSchema,
  TradeAggressionSchema,
  NpcDraftPersonalitySchema,
  DEFAULT_TRADE_RULES,
} from '@/lib/commissioner-ai-draft-manager/types'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const dynamic = 'force-dynamic'

function parseSlotOrder(value: unknown): SlotOrderEntry[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []

    const record = entry as Record<string, unknown>
    if (typeof record.slot !== 'number' || typeof record.rosterId !== 'string' || typeof record.displayName !== 'string') {
      return []
    }

    return [{
      slot: record.slot,
      rosterId: record.rosterId,
      displayName: record.displayName,
      platformUserId: typeof record.platformUserId === 'string' ? record.platformUserId : undefined,
    }]
  })
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const row = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { commissionerAiManagers: true, slotOrder: true },
  })
  if (!row) {
    return NextResponse.json(buildApiResponse(null, []))
  }

  const slotOrder = parseSlotOrder(row.slotOrder)
  const blob = parseCommissionerAiManagers(row.commissionerAiManagers)
  const payload = buildApiResponse(blob, slotOrder)
  return NextResponse.json(payload)
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const existing = await getBlobForLeague(leagueId)
  const mergedMeta = existing?._meta

  const tradeRulesRaw = body.tradeRules ?? {}
  const tradeParsed = CommissionerTradeRulesSchema.safeParse({ ...DEFAULT_TRADE_RULES, ...tradeRulesRaw })
  if (!tradeParsed.success) {
    return NextResponse.json({ error: tradeParsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  }

  const rawTeams = Array.isArray(body.assignedAiTeams) ? body.assignedAiTeams : []
  const assignments: CommissionerAiAssignment[] = rawTeams.map((t: Record<string, unknown>) => ({
    rosterId: String(t.teamId ?? t.rosterId ?? ''),
    aiStyle: AiStyleSchema.parse(t.aiStyle),
    tradeAggression: TradeAggressionSchema.parse(t.tradeAggression),
    active: Boolean(t.active),
    allowOutbound: t.allowOutbound === undefined ? undefined : Boolean(t.allowOutbound),
    allowInbound: t.allowInbound === undefined ? undefined : Boolean(t.allowInbound),
    npcDraftPersonality: t.npcDraftPersonality === undefined ? undefined : NpcDraftPersonalitySchema.parse(t.npcDraftPersonality),
    npcFavoriteTeamAbbr: t.npcFavoriteTeamAbbr === undefined ? undefined : String(t.npcFavoriteTeamAbbr).trim().toUpperCase().slice(0, 8),
  }))

  const validated = await validateAndMergeAssignments({
    leagueId,
    assignments,
    tradeRules: tradeParsed.data,
  })
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  validated.blob._meta = mergedMeta

  try {
    await saveCommissionerAiManagers(leagueId, validated.blob)
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'P2025') {
      return NextResponse.json({ error: 'Create or open a draft session before assigning AI managers.' }, { status: 400 })
    }
    console.error('[commissioner-ai-managers PATCH]', e)
    return NextResponse.json({ error: 'Failed to save draft session' }, { status: 500 })
  }

  const row = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { slotOrder: true, commissionerAiManagers: true },
  })
  const slotOrder = parseSlotOrder(row?.slotOrder)
  const payload = buildApiResponse(parseCommissionerAiManagers(row?.commissionerAiManagers), slotOrder)
  return NextResponse.json({ ok: true, ...payload })
}
