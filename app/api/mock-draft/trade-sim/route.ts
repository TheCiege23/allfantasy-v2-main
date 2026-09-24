import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { prisma } from '@/lib/prisma'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'

const openai = getOpenAIRouteClient()

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const gated = await aiCostGate(req, 'mock_trade_ai', session.user.id)
    if (gated) return gated

    const body = await req.json()
    const { direction, pickNumber, draftId, leagueFormat } = body

    if (!direction || !['up', 'down'].includes(direction)) {
      return NextResponse.json({ error: 'direction must be "up" or "down"' }, { status: 400 })
    }
    if (!pickNumber || typeof pickNumber !== 'number') {
      return NextResponse.json({ error: 'pickNumber is required' }, { status: 400 })
    }

    let draftResults: any[]
    let userTeam: string

    if (draftId) {
      const draft = await prisma.mockDraft.findFirst({
        where: { id: draftId, userId: session.user.id },
      })
      if (!draft) {
        return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
      }
      draftResults = draft.results as any[]
    } else if (body.draftResults && Array.isArray(body.draftResults)) {
      draftResults = body.draftResults
    } else {
      return NextResponse.json({ error: 'draftId or draftResults required' }, { status: 400 })
    }

    const currentPick = draftResults.find((p: any) => p.overall === pickNumber)
    if (!currentPick) {
      return NextResponse.json({ error: 'Pick not found in draft' }, { status: 400 })
    }
    if (!currentPick.isUser) {
      return NextResponse.json({ error: 'Can only simulate trades on your own picks' }, { status: 400 })
    }

    userTeam = currentPick.manager || body.userTeam || 'User'

    const nearbyPicks = draftResults
      .filter((p: any) => {
        if (direction === 'up') {
          return p.overall < pickNumber && p.overall >= pickNumber - 8 && !p.isUser
        } else {
          return p.overall > pickNumber && p.overall <= pickNumber + 8 && !p.isUser
        }
      })
      .sort((a: any, b: any) => direction === 'up' ? b.overall - a.overall : a.overall - b.overall)

    if (nearbyPicks.length === 0) {
      return NextResponse.json({
        error: `No viable trade partners found ${direction === 'up' ? 'above' : 'below'} pick #${pickNumber}`,
      }, { status: 400 })
    }

    const userPicks = draftResults.filter((p: any) => p.isUser)

    const systemPrompt = `You are an expert fantasy football trade negotiator specializing in draft pick trades during live drafts. You understand pick value charts, positional scarcity, and realistic trade scenarios.

You must return valid JSON with this exact structure:
{
  "tradePackage": {
    "userGives": [{ "type": "pick" | "player", "description": string, "value": number }],
    "userGets": [{ "type": "pick" | "player", "description": string, "value": number }],
    "targetManager": string,
    "targetPick": number
  },
  "analysis": string,
  "fairnessScore": number,
  "likelihood": number,
  "playerTarget": string,
  "alternateScenarios": [{ "description": string, "cost": string }]
}`

    const userPrompt = `The user ("${userTeam}") is currently on the clock at pick #${pickNumber} and wants to trade ${direction === 'up' ? 'UP to get an earlier pick' : 'DOWN to accumulate extra picks/value'}.

Current draft state:
- User's picks so far: ${userPicks.map((p: any) => `#${p.overall} ${p.playerName} (${p.position})`).join(', ') || 'None yet'}
- User's current pick: #${pickNumber}
- League format: ${leagueFormat || 'PPR Redraft'}

${direction === 'up' ? `Available targets to trade UP to:\n${nearbyPicks.map((p: any) => `Pick #${p.overall} - ${p.manager} selected ${p.playerName} (${p.position}, ${p.team})`).join('\n')}` : `Picks ahead that could trade DOWN to user:\n${nearbyPicks.map((p: any) => `Pick #${p.overall} - ${p.manager} would select ${p.playerName} (${p.position}, ${p.team})`).join('\n')}`}

Propose a realistic trade package. Consider:
- Pick value differences (earlier picks are exponentially more valuable)
- What the trading partner would realistically accept
- Whether the trade makes strategic sense for both sides
- Future round picks the user could include as sweetener`

    const aiResult = await getOrCreateAiResult({
      feature: 'mock-draft-trade-sim',
      scopeType: 'user',
      scopeId: session.user.id,
      provider: 'openai',
      model: 'gpt-4o-mini',
      ttlSeconds: 30 * 60,
      payload: {
        mockDraftSessionId: (typeof draftId === 'string' && draftId.trim()) || null,
        leagueId: (typeof body?.leagueId === 'string' && body.leagueId.trim()) || null,
        userId: session.user.id,
        sport: String(body?.sport || 'NFL').toUpperCase(),
        season: String(body?.season || ''),
        draftType: String(body?.draftType || ''),
        scoringFormat: String(leagueFormat || ''),
        currentPick: {
          round: Number(currentPick?.round || 0),
          pick: Number(currentPick?.pick || 0),
          overall: Number(pickNumber || 0),
        },
        direction,
        teamNeeds: [
          { manager: userTeam, type: 'user' },
          ...nearbyPicks.map((p: any) => ({ manager: p.manager, overall: p.overall })),
        ],
        availablePlayerIds: nearbyPicks
          .map((p: any) => p.playerId || p.playerName || null)
          .filter(Boolean),
        priorPickIds: draftResults
          .filter((p: any) => Number(p.overall) < Number(pickNumber))
          .map((p: any) => p.playerId || p.playerName || null)
          .filter(Boolean),
        userPicks: userPicks.map((p: any) => ({ overall: p.overall, player: p.playerName, position: p.position })),
        promptVersion: 'v1',
      },
      onCacheMiss: async () => {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: 1500,
        })

        return {
          resultText: completion.choices[0]?.message?.content || '',
          resultJson: null,
          tokenPrompt: null,
          tokenOutput: null,
        }
      },
    })

    if (aiResult.cacheHit) {
      console.log(`[mock-draft/trade-sim] AI cache hit { userId: '${session.user.id}', pickNumber: ${pickNumber} }`)
    } else {
      console.log(`[mock-draft/trade-sim] AI cache miss { userId: '${session.user.id}', pickNumber: ${pickNumber}, modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
      console.log(`[mock-draft/trade-sim] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
    }

    const content = aiResult.row.resultText
    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }

    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch {
      console.error('[trade-sim] Failed to parse:', content.slice(0, 300))
      return NextResponse.json({ error: 'Invalid AI response' }, { status: 500 })
    }

    return NextResponse.json(parsed)
  } catch (err: any) {
    console.error('[trade-sim] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
