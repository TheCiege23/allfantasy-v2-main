import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { withApiUsage } from '@/lib/telemetry/usage'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { runWaiverAIService } from '@/lib/waiver-ai-engine'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'

const SUPPORTED_SPORTS_ENUM = SUPPORTED_SPORTS as [
  (typeof SUPPORTED_SPORTS)[number],
  ...(typeof SUPPORTED_SPORTS)[number][],
]

const LeagueSettingsSchema = z.object({
  isSF: z.boolean().optional(),
  isTEP: z.boolean().optional(),
  numTeams: z.number().int().min(2).max(40).optional(),
  isDynasty: z.boolean().optional(),
})

const AssetValueSchema = z.object({
  impactValue: z.number().optional(),
  marketValue: z.number().optional(),
  vorpValue: z.number().optional(),
  volatility: z.number().optional(),
})

const AvailablePlayerSchema = z.object({
  playerId: z.string().optional(),
  id: z.string().optional(),
  playerName: z.string().optional(),
  name: z.string().optional(),
  position: z.string().optional(),
  team: z.string().nullable().optional(),
  age: z.number().nullable().optional(),
  value: z.number().optional(),
  assetValue: AssetValueSchema.optional(),
  source: z.string().optional(),
  product: z
    .object({
      unified: z.record(z.string(), z.unknown()).optional(),
      yearsExp: z.number().nullable().optional(),
      isRookie: z.boolean().optional(),
      byeWeek: z.number().nullable().optional(),
    })
    .passthrough()
    .optional(),
  lowConfidence: z.boolean().optional(),
  profileSource: z.string().nullable().optional(),
  statsSource: z.string().nullable().optional(),
  fantasyPointsPerGame: z.number().nullable().optional(),
  injuryStatus: z.string().nullable().optional(),
})

const RosterPlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.string(),
  team: z.string().nullable(),
  slot: z.enum(['starter', 'bench', 'ir', 'taxi']),
  age: z.number().nullable(),
  value: z.number(),
})

const TeamNeedsSchema = z.object({
  weakestSlots: z
    .array(
      z.object({
        slot: z.string(),
        position: z.string(),
        currentPlayer: z.string().nullable(),
        currentValue: z.number(),
        leagueMedianValue: z.number(),
        gap: z.number(),
        gapPpg: z.number(),
      })
    )
    .default([]),
  biggestNeed: z
    .object({
      slot: z.string(),
      position: z.string(),
      currentPlayer: z.string().nullable(),
      currentValue: z.number(),
      leagueMedianValue: z.number(),
      gap: z.number(),
      gapPpg: z.number(),
    })
    .nullable()
    .default(null),
  byeWeekClusters: z
    .array(
      z.object({
        week: z.number(),
        playersOut: z.array(z.string()),
        positionsAffected: z.array(z.string()),
        severity: z.enum(['critical', 'moderate', 'minor']),
      })
    )
    .default([]),
  positionalDepth: z
    .array(
      z.object({
        position: z.string(),
        count: z.number(),
        leagueMedianCount: z.number(),
        totalValue: z.number(),
        leagueMedianValue: z.number(),
        depthRating: z.number(),
      })
    )
    .default([]),
  dropCandidates: z
    .array(
      z.object({
        playerId: z.string(),
        playerName: z.string(),
        position: z.string(),
        value: z.number(),
        riskOfRegret: z.number(),
        riskLabel: z.string(),
        reason: z.string(),
      })
    )
    .default([]),
})

const RequestSchema = z.object({
  sport: z.enum(SUPPORTED_SPORTS_ENUM).optional(),
  leagueId: z.string().min(1).optional(),
  includeAIExplanation: z.boolean().optional(),
  confirmTokenSpend: z.boolean().optional().default(false),
  roster: z.array(RosterPlayerSchema).optional(),
  teamNeeds: TeamNeedsSchema.optional(),
  rosterPositions: z.array(z.string()).optional(),
  allLeagueRosters: z.array(z.object({ players: z.array(RosterPlayerSchema) })).optional(),
  currentWeek: z.number().int().min(1).max(30).optional(),
  goal: z.enum(['win-now', 'balanced', 'rebuild']).optional(),
  leagueSettings: LeagueSettingsSchema.default({}),
  availablePlayers: z.array(AvailablePlayerSchema).min(1),
  maxResults: z.number().int().min(1).max(25).optional(),
})

export const dynamic = 'force-dynamic'

export const POST = withApiUsage({
  endpoint: '/api/waiver-ai/engine',
  tool: 'WaiverAiEngine',
})(async (request: NextRequest, _ctx?: unknown) => {
  let userId: string | null = null
  let tokenFallbackLedgerId: string | null = null
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    userId = session?.user?.id ?? null
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const parsed = RequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request payload', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const input = parsed.data
    if (input.leagueId) {
      try {
        await assertLeagueMember(input.leagueId, userId)
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const gate = await requireFeatureEntitlement({
      userId,
      userEmail: session?.user?.email,
      featureId: 'ai_waivers',
      allowTokenFallback: true,
      confirmTokenSpend: Boolean(input.confirmTokenSpend),
      tokenRuleCode: 'ai_waiver_engine_run',
      tokenSourceType: 'waiver_ai_engine',
      tokenSourceId: `${input.leagueId ?? 'waiver'}:${Date.now()}`,
      tokenDescription: 'Waiver AI engine run',
      tokenMetadata: {
        leagueId: input.leagueId ?? null,
        sport: input.sport ?? null,
        includeAIExplanation: Boolean(input.includeAIExplanation),
      },
    })
    if (!gate.ok) return gate.response
    if (gate.tokenSpend) tokenFallbackLedgerId = gate.tokenSpend.id

    const analysis = await runWaiverAIService(input)
    return NextResponse.json({
      success: true,
      analysis,
      tokenSpend: gate.tokenSpend
        ? {
            ruleCode: gate.tokenPreview?.ruleCode ?? 'ai_waiver_engine_run',
            tokenCost: gate.tokenPreview?.tokenCost ?? null,
            balanceAfter: gate.tokenSpend.balanceAfter,
            ledgerId: gate.tokenSpend.id,
          }
        : null,
    })
  } catch (error) {
    if (tokenFallbackLedgerId && userId) {
      await new TokenSpendService()
        .refundSpendByLedger({
          userId,
          spendLedgerId: tokenFallbackLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'waiver_ai_engine_refund',
          sourceId: tokenFallbackLedgerId,
          idempotencyKey: `refund:waiver_ai_engine:${tokenFallbackLedgerId}`,
          description: 'Auto refund after failed waiver AI request.',
          metadata: {},
        })
        .catch(() => null)
    }
    console.error('[waiver-ai/engine]', error)
    return NextResponse.json({ error: 'Waiver AI failed' }, { status: 500 })
  }
})
