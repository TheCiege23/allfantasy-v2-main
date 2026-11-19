/**
 * [UPDATED] app/api/tournament/[tournamentId]/ai/route.ts
 * POST: Generate tournament AI content (recaps, standings analysis, bubble watch, etc.)
 * Uses deterministic context only — AI never decides outcomes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  buildTournamentAiCacheContextSummary,
  generateTournamentAI,
} from '@/lib/tournament-mode/ai/TournamentAIService'
import { buildTournamentAIContext } from '@/lib/tournament-mode/ai/TournamentAIContext'
import type { TournamentAIType } from '@/lib/tournament-mode/ai/TournamentAIPrompts'
import {
  canViewCommissionerDashboard,
  getLegacyTournamentAccess,
} from '@/lib/tournament/legacyTournamentAccess'
import {
  buildAiCacheKey,
  createSmokeAiResult,
  isAiResultCacheSmokeProviderEnabled,
  readAiResultCache,
  writeAiResultCache,
} from '@/lib/ai-result-cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const TOURNAMENT_AI_CACHE_TTL_MS = 30 * 60 * 1000

const AI_TYPE_TO_PURPOSE: Record<string, 'commissioner' | 'announcement' | 'recap' | 'standings' | 'bracket' | 'draft_prep'> = {
  commissioner_assistant: 'commissioner',
  round_announcement: 'announcement',
  weekly_recap: 'recap',
  bubble_watch: 'standings',
  finals_hype: 'bracket',
  champion_story: 'recap',
  draft_prep: 'draft_prep',
  standings_analysis: 'standings',
  bracket_preview: 'bracket',
}

const VALID_AI_TYPES = new Set<string>([
  'commissioner_assistant',
  'round_announcement',
  'weekly_recap',
  'bubble_watch',
  'finals_hype',
  'champion_story',
  'draft_prep',
  'standings_analysis',
  'bracket_preview',
])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params

  // Verify tournament exists and resolve access
  const tournament = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, creatorId: true },
  })
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })

  const access = await getLegacyTournamentAccess(userId, tournamentId)
  const hasCommissionerAccess = access.isCreator || canViewCommissionerDashboard(access)

  const [participant, feederLeagueMember] = await Promise.all([
    prisma.legacyTournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
      select: { id: true },
    }),
    prisma.legacyTournamentLeague.findFirst({
      where: {
        tournamentId,
        league: {
          OR: [
            { userId },
            { teams: { some: { claimedByUserId: userId } } },
          ],
        },
      },
      select: { id: true },
    }),
  ])

  const body = await req.json().catch(() => ({}))
  const aiType = body.type as string
  if (!aiType || !VALID_AI_TYPES.has(aiType)) {
    return NextResponse.json(
      { error: `Invalid Chimmy type. Valid types: ${[...VALID_AI_TYPES].join(', ')}` },
      { status: 400 }
    )
  }

  // Commissioner-only types
  const commissionerOnlyTypes = new Set(['commissioner_assistant'])
  if (commissionerOnlyTypes.has(aiType) && !hasCommissionerAccess) {
    return NextResponse.json({ error: 'Commissioner access required for this AI type' }, { status: 403 })
  }

  if (!commissionerOnlyTypes.has(aiType) && !hasCommissionerAccess && !participant && !feederLeagueMember) {
    return NextResponse.json({ error: 'Tournament membership required' }, { status: 403 })
  }

  try {
    const purpose = AI_TYPE_TO_PURPOSE[aiType] ?? 'recap'
    const context = await buildTournamentAIContext(tournamentId, purpose)
    const roundIndex = typeof body.roundIndex === 'number' ? body.roundIndex : undefined
    const announcementType = typeof body.announcementType === 'string' ? body.announcementType : undefined

    if (!context) {
      return NextResponse.json({ error: 'Could not build tournament context' }, { status: 500 })
    }

    const cacheInputs = {
      tournamentId,
      type: aiType,
      purpose,
      roundIndex: roundIndex ?? null,
      announcementType: announcementType ?? null,
      userId,
      hasCommissionerAccess,
      isParticipant: Boolean(participant),
      isFeederLeagueMember: Boolean(feederLeagueMember),
      contextSummary: buildTournamentAiCacheContextSummary(context),
    }
    const { resultKey, inputHash } = buildAiCacheKey('tournament-ai', cacheInputs)
    const cached = await readAiResultCache(resultKey)
    if (cached?.resultJson && typeof cached.resultJson === 'object') {
      return NextResponse.json(cached.resultJson)
    }

    const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()
    if (smokeProviderEnabled) {
      const smoke = createSmokeAiResult({
        feature: 'tournament-ai',
        route: '/api/tournament/[tournamentId]/ai',
        input: cacheInputs,
      })
      const smokePayload = {
        text: smoke.text,
        model: 'smoke-provider',
      }

      await writeAiResultCache({
        resultKey,
        inputHash,
        feature: 'tournament-ai',
        scopeType: 'tournament',
        scopeId: tournamentId,
        provider: 'smoke-provider',
        model: 'smoke-provider',
        inputJson: cacheInputs,
        resultJson: smokePayload,
        ttlMs: TOURNAMENT_AI_CACHE_TTL_MS,
      })

      return NextResponse.json(smokePayload)
    }

    const result = await generateTournamentAI(
      aiType as TournamentAIType,
      context,
      { roundIndex, announcementType }
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'AI generation failed' }, { status: 500 })
    }

    const responsePayload = { text: result.text, model: result.model }
    writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'tournament-ai',
      scopeType: 'tournament',
      scopeId: tournamentId,
      provider: 'openai',
      model: result.model ?? 'gpt-4o-mini',
      inputJson: cacheInputs,
      resultJson: responsePayload,
      ttlMs: TOURNAMENT_AI_CACHE_TTL_MS,
    }).catch(() => undefined)

    return NextResponse.json(responsePayload)
  } catch (e) {
    console.error('[tournament/ai] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Chimmy generation failed' },
      { status: 500 }
    )
  }
}
