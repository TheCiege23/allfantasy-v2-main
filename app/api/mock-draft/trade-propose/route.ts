import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { prisma } from '@/lib/prisma'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'

const openai = getOpenAIRouteClient()

const POSITION_TARGETS: Record<string, { starter: number; ideal: number }> = {
  QB: { starter: 1, ideal: 2 },
  RB: { starter: 2, ideal: 4 },
  WR: { starter: 2, ideal: 4 },
  TE: { starter: 1, ideal: 2 },
}

function getTeamNeeds(
  picks: any[],
  manager: string,
  throughRound: number
): { score: number; topNeed: string | null } {
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  for (const p of picks) {
    if (p.manager === manager && p.round <= throughRound && counts[p.position] !== undefined) {
      counts[p.position]++
    }
  }

  let maxNeed = 0
  let topNeed: string | null = null
  let totalNeed = 0

  for (const [pos, targets] of Object.entries(POSITION_TARGETS)) {
    const count = counts[pos] || 0
    let need = 0
    if (count < targets.starter) {
      need = 70 + (targets.starter - count) * 15
    } else if (count < targets.ideal) {
      need = 30 + (targets.ideal - count) * 10
    }
    totalNeed += need
    if (need > maxNeed) {
      maxNeed = need
      topNeed = pos
    }
  }

  return { score: Math.round(totalNeed / 4), topNeed }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const gated = await aiCostGate(req, 'mock_trade_ai', session.user.id)
    if (gated) return gated

    const { leagueId, draftResults: clientDraft } = await req.json()

    if (!leagueId) {
      return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
    }

    const draft = await prisma.mockDraft.findFirst({
      where: { leagueId, userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    })

    let draftResults: any[] = clientDraft
    if (!draftResults || !Array.isArray(draftResults) || draftResults.length === 0) {
      if (!draft || !Array.isArray(draft.results)) {
        return NextResponse.json({ error: 'No draft found' }, { status: 404 })
      }
      draftResults = draft.results as any[]
    }

    if (!draft) {
      return NextResponse.json({ error: 'No draft record found' }, { status: 404 })
    }

    const league = await prisma.league.findFirst({
      where: { id: leagueId, userId: session.user.id },
    })

    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }
    if (String((league as any).sport || 'NFL').toUpperCase() !== 'NFL') {
      return NextResponse.json(
        { proposals: [], message: 'Draft-day trade proposals are currently available for NFL mock drafts only.' },
      )
    }

    const userManager = draftResults.find((p: any) => p.isUser)?.manager
    if (!userManager) {
      return NextResponse.json({ error: 'No user picks found in draft' }, { status: 400 })
    }

    const totalRounds = Math.max(...draftResults.map((p: any) => p.round))
    const userPicks = draftResults.filter((p: any) => p.isUser)
    const otherManagers = Array.from(new Set(
      draftResults.filter((p: any) => !p.isUser).map((p: any) => p.manager)
    ))

    const proposals: any[] = []

    for (const userPick of userPicks) {
      if (userPick.round > totalRounds - 2) continue

      const nearbyPicks = draftResults.filter((p: any) =>
        !p.isUser &&
        Math.abs(p.overall - userPick.overall) <= 8 &&
        Math.abs(p.overall - userPick.overall) >= 2
      )

      for (const candidatePick of nearbyPicks) {
        const otherNeeds = getTeamNeeds(draftResults, candidatePick.manager, userPick.round)

        if (otherNeeds.score < 40) continue

        const userNeeds = getTeamNeeds(draftResults, userManager, userPick.round)
        const playerAtUserPick = userPick.playerName
        const playerAtOtherPick = candidatePick.playerName

        const isUpTrade = candidatePick.overall < userPick.overall
        const pickDiff = Math.abs(candidatePick.overall - userPick.overall)

        if (isUpTrade && otherNeeds.score < 50) continue
        if (!isUpTrade && pickDiff < 3) continue

        proposals.push({
          pickOverall: userPick.overall,
          fromTeam: candidatePick.manager,
          fromPick: candidatePick.overall,
          direction: isUpTrade ? 'up' : 'down',
          theyGive: `Pick #${candidatePick.overall} (${playerAtOtherPick}, ${candidatePick.position})`,
          youGive: `Pick #${userPick.overall} (${playerAtUserPick}, ${userPick.position})`,
          theirNeedScore: otherNeeds.score,
          theirTopNeed: otherNeeds.topNeed,
          yourNeedScore: userNeeds.score,
          reason: '',
        })

        if (proposals.filter(p => p.pickOverall === userPick.overall).length >= 1) break
      }
    }

    const bestProposals = proposals
      .sort((a, b) => b.theirNeedScore - a.theirNeedScore)
      .slice(0, 5)

    if (bestProposals.length === 0) {
      return NextResponse.json({ proposals: [] })
    }

    const systemPrompt = `You are a fantasy football trade analyst. For each proposed draft-day trade, write a brief 1-sentence reason why this trade makes sense for both sides. Return valid JSON:
{ "reasons": [string] }
Each reason should be concise and mention the key motivation (positional need, value gain, draft capital movement).`

    const userPrompt = `Generate reasons for these ${bestProposals.length} draft-day trade proposals in a ${league?.scoring || 'PPR'} ${league?.isDynasty ? 'dynasty' : 'redraft'} league:

${bestProposals.map((p, i) => `${i + 1}. ${p.fromTeam} (need score: ${p.theirNeedScore}, top need: ${p.theirTopNeed}) offers pick #${p.fromPick} for ${userManager}'s pick #${p.pickOverall}. Direction: trade ${p.direction}.`).join('\n')}

Return exactly ${bestProposals.length} reasons in the "reasons" array.`

    try {
      const aiResult = await getOrCreateAiResult({
        feature: 'mock-draft-trade-propose',
        scopeType: 'league',
        scopeId: leagueId,
        provider: 'openai',
        model: 'gpt-4o-mini',
        ttlSeconds: 30 * 60,
        payload: {
          mockDraftSessionId: draft.id,
          leagueId,
          userId: session.user.id,
          sport: 'NFL',
          season: String((league as any)?.season || ''),
          draftType: String((league as any)?.draftType || ''),
          scoringFormat: String(league?.scoring || ''),
          currentPick: {
            round: 0,
            pick: 0,
            overall: Number(bestProposals[0]?.pickOverall || 0),
          },
          teamNeeds: bestProposals.map((p) => ({
            manager: p.fromTeam,
            theirNeedScore: p.theirNeedScore,
            theirTopNeed: p.theirTopNeed,
            yourNeedScore: p.yourNeedScore,
          })),
          availablePlayerIds: bestProposals
            .map((p) => `${p.fromPick}:${p.pickOverall}`)
            .slice(0, 30),
          priorPickIds: draftResults
            .map((p: any) => p.playerId || p.playerName || null)
            .filter(Boolean)
            .slice(0, 400),
          proposals: bestProposals.map((p) => ({
            pickOverall: p.pickOverall,
            fromTeam: p.fromTeam,
            fromPick: p.fromPick,
            direction: p.direction,
            theirNeedScore: p.theirNeedScore,
            theirTopNeed: p.theirTopNeed,
            yourNeedScore: p.yourNeedScore,
          })),
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
            temperature: 0.6,
            max_tokens: 1000,
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
        console.log(`[mock-draft/trade-propose] AI cache hit { leagueId: '${leagueId}' }`)
      } else {
        console.log(`[mock-draft/trade-propose] AI cache miss { leagueId: '${leagueId}', modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
        console.log(`[mock-draft/trade-propose] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
      }

      const content = aiResult.row.resultText
      if (content) {
        const parsed = JSON.parse(content)
        const reasons = parsed.reasons || []
        for (let i = 0; i < bestProposals.length; i++) {
          bestProposals[i].reason = reasons[i] || ''
        }
      }
    } catch (aiErr) {
      console.error('[trade-propose] AI reason generation failed:', aiErr)
    }

    try {
      await prisma.mockDraft.update({
        where: { id: draft.id },
        data: { proposals: bestProposals },
      })
    } catch (saveErr) {
      console.error('[trade-propose] Failed to save proposals:', saveErr)
    }

    return NextResponse.json({ proposals: bestProposals })
  } catch (err: any) {
    console.error('[trade-propose] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
