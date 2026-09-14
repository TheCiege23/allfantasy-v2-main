/**
 * POST /api/leagues/[leagueId]/player-comparison/start-vs
 *
 * Sample request:
 * {
 *   "userId": "optional — ignored; server uses session",
 *   "teamId": "cuid",
 *   "sport": "NBA",
 *   "scoringFormat": "ppr",
 *   "weekOrPeriod": "Week 7",
 *   "playerA": "Player A",
 *   "playerB": "Player B",
 *   "lineupSlot": "FLEX",
 *   "opponent": "optional label",
 *   "strategyMode": "balanced",
 *   "includeAIExplanation": true,
 *   "userPreference": "playerA",
 *   "screenshotContext": { "notes": "from Chimmy OCR" }
 * }
 *
 * Response includes `coach_lens`: median, safer, ceiling, favored/underdog leans, confidence, concise_explanation.
 */

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { createActionEvent } from '@/lib/chimmy-actions/server-store'
import { recordStartVsAdvice } from '@/lib/chimmy-advice/startVsAdvice'
import { prisma } from '@/lib/prisma'
import {
  runTwoPlayerComparisonEngine,
  buildStartVsResponse,
  type StartVsStrategyMode,
} from '@/lib/player-comparison-lab'
import { resolveStartVsDisplayMedia } from '@/lib/player-comparison-lab/resolve-start-vs-display'
import type { LeagueScoringSettings, ScoringFormat } from '@/lib/player-comparison-lab/types'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

const SCORING_FORMATS: ScoringFormat[] = ['ppr', 'half_ppr', 'non_ppr']

const BodySchema = z.object({
  teamId: z.string().trim().min(1).optional().nullable(),
  sport: z.string().trim().min(1).optional().nullable(),
  scoringFormat: z.enum(['ppr', 'half_ppr', 'non_ppr']).optional().nullable(),
  leagueScoringSettings: z.any().optional().nullable(),
  weekOrPeriod: z.string().trim().min(1).optional().nullable(),
  playerA: z.string().trim().min(1),
  playerB: z.string().trim().min(1),
  lineupSlot: z.string().trim().min(1).optional().nullable(),
  opponent: z.string().trim().min(1).optional().nullable(),
  strategyMode: z.enum([
    'safest_floor',
    'balanced',
    'highest_upside',
    'underdog_mode',
    'protect_lead',
  ]),
  includeAIExplanation: z.boolean().optional().default(false),
  screenshotContext: z
    .object({
      notes: z.string().optional().nullable(),
      extractedNames: z.array(z.string()).optional().nullable(),
    })
    .optional()
    .nullable(),
  /** Tie-break median projection only when both players are effectively tied */
  userPreference: z.enum(['playerA', 'playerB']).optional().nullable(),
})

function leagueScoringToFormat(scoring: string | null | undefined): ScoringFormat {
  const x = (scoring ?? '').toLowerCase()
  if (x.includes('half')) return 'half_ppr'
  if (x === 'standard' || x.includes('non') || x.includes('std')) return 'non_ppr'
  return 'ppr'
}

function coerceLeagueScoringSettings(raw: unknown): LeagueScoringSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    ppr: typeof o.ppr === 'number' ? o.ppr : null,
    tePremium: typeof o.tePremium === 'number' ? o.tePremium : null,
    superflex: typeof o.superflex === 'boolean' ? o.superflex : null,
    passTdPoints: typeof o.passTdPoints === 'number' ? o.passTdPoints : null,
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string; email?: string | null } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  let body: z.infer<typeof BodySchema>
  try {
    const json = await req.json()
    body = BodySchema.parse(json)
  } catch (e) {
    return NextResponse.json({ error: 'Invalid body', details: String(e) }, { status: 400 })
  }

  try {
    await assertLeagueMember(leagueId, userId)
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status ?? 403
    return NextResponse.json({ error: 'Forbidden' }, { status })
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, scoring: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const sport = normalizeToSupportedSport(body.sport ?? league.sport)
  const scoringFormat =
    body.scoringFormat && SCORING_FORMATS.includes(body.scoringFormat)
      ? body.scoringFormat
      : leagueScoringToFormat(league.scoring)

  const settingsJson = league.settings as Record<string, unknown> | null
  const scoringFromSettings =
    settingsJson && typeof settingsJson.scoringSystem === 'string'
      ? leagueScoringToFormat(String(settingsJson.scoringSystem))
      : null
  const effectiveScoringFormat = scoringFromSettings ?? scoringFormat

  const leagueScoringSettings =
    coerceLeagueScoringSettings(body.leagueScoringSettings) ??
    coerceLeagueScoringSettings(settingsJson?.scoringOverrides) ??
    null

  let includeAIExplanation = body.includeAIExplanation
  let explanationGate: {
    requiredPlan: string | null
    message: string
    upgradePath: string
  } | null = null

  if (includeAIExplanation) {
    const gate = new FeatureGateService()
    const decision = await gate.evaluateUserFeatureAccess(
      userId,
      'player_comparison_explanations',
      session?.user?.email ?? null
    )
    if (!decision.allowed) {
      includeAIExplanation = false
      explanationGate = {
        requiredPlan: decision.requiredPlan,
        message: decision.message,
        upgradePath: decision.upgradePath,
      }
    }
  }

  const started = Date.now()
  const engine = await runTwoPlayerComparisonEngine({
    playerAName: body.playerA,
    playerBName: body.playerB,
    sport,
    scoringFormat: effectiveScoringFormat,
    leagueScoringSettings,
    includeAIExplanation,
  })

  if (!engine) {
    return NextResponse.json(
      { error: 'Could not resolve one or both players for comparison' },
      { status: 404 }
    )
  }

  const strategyMode = body.strategyMode as StartVsStrategyMode
  let payload = buildStartVsResponse(engine, {
    strategyMode,
    leagueId,
    teamId: body.teamId ?? null,
    lineupSlot: body.lineupSlot ?? null,
    weekOrPeriod: body.weekOrPeriod ?? null,
    userPreference: body.userPreference ?? null,
  })

  if (body.screenshotContext?.notes || (body.screenshotContext?.extractedNames?.length ?? 0) > 0) {
    payload = {
      ...payload,
      missing_data: [
        ...payload.missing_data,
        ...(body.screenshotContext?.notes ? [`Screenshot context: ${body.screenshotContext.notes}`] : []),
      ],
    }
  }
  if (body.opponent) {
    payload = {
      ...payload,
      missing_data: [...payload.missing_data, `Opponent context noted: ${body.opponent} (not yet modeled in deterministic layer).`],
    }
  }

  try {
    const display = await resolveStartVsDisplayMedia({
      sport: engine.sport,
      playerA: { name: engine.comparison.playerA.name, team: engine.comparison.playerA.team },
      playerB: { name: engine.comparison.playerB.name, team: engine.comparison.playerB.team },
    })
    payload = { ...payload, display }
  } catch {
    /* non-fatal */
  }

  void createActionEvent({
    id: randomUUID(),
    actionType: 'compare_alternatives',
    surface: 'start_vs_comparison',
    userId,
    leagueId,
    teamId: body.teamId ?? null,
    sport: engine.sport,
    event: 'completed',
    timestamp: Date.now(),
    durationMs: Date.now() - started,
    metadata: {
      winner: payload.winner,
      confidence_pct: payload.confidence_pct,
      strategy_mode: strategyMode,
      lineup_slot: body.lineupSlot ?? null,
      week_or_period: body.weekOrPeriod ?? null,
      coach_tiebreak: payload.coach_lens.tiebreak_applied,
    },
  }).catch(() => {})

  // The call, kept for the home Receipts card. Fire-and-forget: it never changes this response.
  void recordStartVsAdvice({
    userId,
    leagueId,
    winner: payload.winner,
    confidencePct: payload.confidence_pct,
    playerAName: engine.comparison.playerA.name,
    playerBName: engine.comparison.playerB.name,
    lineupSlot: body.lineupSlot ?? null,
    weekOrPeriod: body.weekOrPeriod ?? null,
  }).catch(() => {})

  return NextResponse.json({
    ...payload,
    leagueId,
    explanationGate,
  })
}
