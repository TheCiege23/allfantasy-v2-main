import { withPaidToolBilling, paidToolNotDelivered } from '@/lib/tokens/paidToolBilling'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { deepseekChat } from '@/lib/deepseek-client'
import {
  xaiChatJson,
  parseTextFromXaiChatCompletion,
} from '@/lib/xai-client'
import { openaiChatText } from '@/lib/openai-client'
import {
  isDeepSeekAvailable,
  isOpenAIAvailable,
  isXaiAvailable,
} from '@/lib/provider-config'
import {
  requireFeatureEntitlement,
} from '@/lib/subscription/entitlement-middleware'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'

type InsightBody = {
  playerA?: string
  playerB?: string
  players?: string[]
  summaryLines?: string[]
  confirmTokenSpend?: boolean
  sport?: string | null
  scoringFormat?: string | null
  matrix?: Array<{
    label?: string
    winnerName?: string | null
    valuesByPlayer?: Record<string, number | null>
  }>
  categoryWinners?: Array<{ label?: string; winnerName?: string; value?: number | null }>
  playerScores?: Array<{
    playerName?: string
    vorpDifference?: number | null
    projectionDelta?: number | null
    consistencyScore?: number | null
    volatilityScore?: number | null
  }>
}

function formatNum(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function buildDeterministicBrief(body: InsightBody): {
  playersList: string[]
  summaryLines: string[]
  deterministicBrief: string
} {
  const summaryLines = Array.isArray(body.summaryLines) ? body.summaryLines : []
  const playersList =
    Array.isArray(body.players) && body.players.length >= 2
      ? body.players.map((p) => String(p).trim()).filter(Boolean)
      : ([body.playerA?.trim(), body.playerB?.trim()].filter(Boolean) as string[])

  const matrixRows = Array.isArray(body.matrix) ? body.matrix : []
  const matrixLines = matrixRows
    .slice(0, 10)
    .map((row) => {
      const winner = row.winnerName ?? 'n/a'
      const valuesByPlayer = row.valuesByPlayer ?? {}
      const valuesText = Object.entries(valuesByPlayer)
        .map(([name, value]) => `${name}: ${formatNum(value)}`)
        .join(' | ')
      return `${row.label ?? 'Dimension'} -> winner: ${winner}; values: ${valuesText}`
    })

  const scoreRows = Array.isArray(body.playerScores) ? body.playerScores : []
  const scoreLines = scoreRows.map(
    (row) =>
      `${row.playerName ?? 'Player'} | VORP diff ${formatNum(row.vorpDifference)} | projection delta ${formatNum(
        row.projectionDelta
      )} | consistency ${formatNum(row.consistencyScore)} | volatility ${formatNum(row.volatilityScore)}`
  )

  const winners = Array.isArray(body.categoryWinners) ? body.categoryWinners : []
  const winnerLines = winners
    .slice(0, 8)
    .map((winner) => `${winner.label ?? 'Dimension'}: ${winner.winnerName ?? 'n/a'} (${formatNum(winner.value)})`)

  const deterministicBrief = [
    `Sport: ${body.sport ?? 'unknown'} | Scoring: ${body.scoringFormat ?? 'unknown'}`,
    `Players: ${playersList.join(', ') || 'n/a'}`,
    'Summary lines:',
    ...(summaryLines.length > 0 ? summaryLines.map((line) => `- ${line}`) : ['- n/a']),
    'Category winners:',
    ...(winnerLines.length > 0 ? winnerLines.map((line) => `- ${line}`) : ['- n/a']),
    'Player deterministic scores:',
    ...(scoreLines.length > 0 ? scoreLines.map((line) => `- ${line}`) : ['- n/a']),
    'Comparison matrix rows:',
    ...(matrixLines.length > 0 ? matrixLines.map((line) => `- ${line}`) : ['- n/a']),
  ].join('\n')

  return { playersList, summaryLines, deterministicBrief }
}

function buildDeterministicFallback(playersList: string[], summaryLines: string[]): string {
  const header = playersList.length > 0 ? `Players: ${playersList.join(', ')}` : 'Player comparison'
  const lead = summaryLines[0] ?? 'Deterministic comparison generated successfully.'
  const second = summaryLines[1] ?? 'Use category winners and VORP/projection deltas to break close decisions.'
  return `${header}. ${lead} ${second}`.trim()
}

async function paidToolPost(req: Request) {
  let userId: string | null = null
  let tokenFallbackLedgerId: string | null = null
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    userId = session?.user?.id ?? null
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Sign in to use AI player comparison explanations.' },
        { status: 401 }
      )
    }

    let body: InsightBody
    try {
      body = (await req.json()) as InsightBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { playersList, summaryLines, deterministicBrief } = buildDeterministicBrief(body)
    if (playersList.length < 2) {
      return NextResponse.json({ error: 'Provide at least 2 players' }, { status: 400 })
    }

    const gate = await requireFeatureEntitlement({
      userId,
      userEmail: session?.user?.email,
      featureId: 'player_comparison_explanations',
      allowTokenFallback: true,
      confirmTokenSpend: Boolean(body.confirmTokenSpend),
      tokenRuleCode: 'ai_player_comparison_quick_explanation',
      tokenSourceType: 'player_comparison_insight',
      tokenSourceId: `${playersList.slice(0, 2).join('::')}:${Date.now()}`,
      tokenDescription: 'Player comparison quick explanation',
      tokenMetadata: {
        sport: body.sport ?? null,
        scoringFormat: body.scoringFormat ?? null,
        players: playersList.slice(0, 6),
      },
    })
    if (!gate.ok) return gate.response
    if (gate.tokenSpend) tokenFallbackLedgerId = gate.tokenSpend.id

    const providerStatus = {
      deepseek: isDeepSeekAvailable(),
      grok: isXaiAvailable(),
      openai: isOpenAIAvailable(),
    }

    let deepseekAnalysis: string | null = null
    let grokNarrative: string | null = null
    let openaiSummary: string | null = null
    const deterministicFallback = buildDeterministicFallback(playersList, summaryLines)

    if (providerStatus.deepseek) {
      const deepseek = await deepseekChat({
        systemPrompt:
          'You are DeepSeek in the AllFantasy Player Comparison Lab. Focus only on mathematical edges from deterministic data. 3-4 concise sentences.',
        prompt: [
          'Analyze the matrix mathematically. Identify who has the strongest measurable edge and why.',
          'Do not invent data; cite only provided numbers and winners.',
          '',
          deterministicBrief,
        ].join('\n'),
        temperature: 0.2,
        maxTokens: 350,
      })
      deepseekAnalysis = deepseek.content?.trim() || null
    }

    if (providerStatus.grok) {
      const grok = await xaiChatJson({
        model: process.env.XAI_MODEL || process.env.GROK_MODEL || 'grok-4-fast-non-reasoning',
        temperature: 0.4,
        maxTokens: 350,
        messages: [
          {
            role: 'system',
            content:
              'You are Grok in the AllFantasy Player Comparison Lab. Provide narrative context only: trend momentum, hype vs reality, role/usage context. Keep it concise and grounded in provided facts.',
          },
          {
            role: 'user',
            content: [
              'Use these deterministic facts as the source of truth.',
              deterministicBrief,
              deepseekAnalysis
                ? `\nDeepSeek quantitative notes:\n${deepseekAnalysis}`
                : '',
            ].join('\n'),
          },
        ],
      })
      grokNarrative = grok.ok ? parseTextFromXaiChatCompletion(grok.json)?.trim() ?? null : null
    }

    if (providerStatus.openai) {
      const openai = await openaiChatText({
        temperature: 0.35,
        maxTokens: 380,
        messages: [
          {
            role: 'system',
            content:
              'You are OpenAI in the AllFantasy Player Comparison Lab. Produce the final user-facing recommendation summary. 3-5 sentences. Blend deterministic edge, risk context, and a clear recommendation.',
          },
          {
            role: 'user',
            content: [
              deterministicBrief,
              deepseekAnalysis ? `\nDeepSeek quantitative analysis:\n${deepseekAnalysis}` : '',
              grokNarrative ? `\nGrok narrative context:\n${grokNarrative}` : '',
              '\nReturn plain recommendation text only.',
            ].join('\n'),
          },
        ],
      })
      openaiSummary = openai.ok ? openai.text.trim() : null
    }

    if (!openaiSummary && !deepseekAnalysis && !grokNarrative) paidToolNotDelivered()

    const finalRecommendation =
      openaiSummary ??
      deepseekAnalysis ??
      grokNarrative ??
      deterministicFallback

    return NextResponse.json({
      recommendation: finalRecommendation,
      finalRecommendation,
      providerAnalyses: {
        deepseek: deepseekAnalysis,
        grok: grokNarrative,
        openai: openaiSummary,
      },
      providerStatus,
      tokenSpend: gate.tokenSpend
        ? {
            ruleCode: gate.tokenPreview?.ruleCode ?? 'ai_player_comparison_quick_explanation',
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
          sourceType: 'player_comparison_insight_refund',
          sourceId: tokenFallbackLedgerId,
          idempotencyKey: `refund:player_comparison_insight:${tokenFallbackLedgerId}`,
          description: 'Auto refund after failed player comparison insight request.',
          metadata: {},
        })
        .catch(() => null)
    }
    console.error('[player-comparison/insight]', error)
    return NextResponse.json({ error: 'Insight generation failed' }, { status: 500 })
  }
}

export const POST = withPaidToolBilling(paidToolPost)
