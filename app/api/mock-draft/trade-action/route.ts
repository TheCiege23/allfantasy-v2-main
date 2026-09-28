import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { prisma } from '@/lib/prisma'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { getLiveADP, formatADPForPrompt } from '@/lib/adp-data'
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

    const { leagueId, pickNumber, action } = await req.json()

    const mock = await prisma.mockDraft.findFirst({
      where: { leagueId, userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    })

    if (!mock) {
      return NextResponse.json({ error: 'No draft found' }, { status: 404 })
    }

    let updatedResults = mock.results as any[]

    if (action === 'accept') {
      const storedProposals = (mock.proposals as any[]) || []
      const proposal = storedProposals.find((p: any) => p.pickOverall === pickNumber)

      if (!proposal) {
        return NextResponse.json({ error: `No trade proposal found for pick #${pickNumber}` }, { status: 404 })
      }

      const originalDraft = updatedResults.map(p => ({ ...p }))
      const userPick = originalDraft.find((p: any) => p.overall === pickNumber && p.isUser)
      const partnerPick = originalDraft.find((p: any) => p.overall === proposal.fromPick && !p.isUser)

      if (!userPick || !partnerPick) {
        return NextResponse.json({ error: 'Invalid trade picks' }, { status: 400 })
      }

      const league = await prisma.league.findFirst({
        where: { id: leagueId, userId: session.user.id },
      })

      if (!league) {
        return NextResponse.json({ error: 'League not found' }, { status: 404 })
      }
      if (String((league as any).sport || 'NFL').toUpperCase() !== 'NFL') {
        return NextResponse.json(
          { error: 'Draft-day trade re-simulation is currently available for NFL mock drafts only.' },
          { status: 400 },
        )
      }

      const tradePoint = Math.min(pickNumber, proposal.fromPick)
      const lockedPicks = originalDraft.filter((p: any) => p.overall < tradePoint)
      const picksToRedraft = originalDraft
        .filter((p: any) => p.overall >= tradePoint)
        .map(p => ({ ...p }))

      for (const p of picksToRedraft) {
        if (p.overall === pickNumber) {
          p.manager = partnerPick.manager
          p.managerAvatar = partnerPick.managerAvatar || null
          p.isUser = false
        } else if (p.overall === proposal.fromPick) {
          p.manager = userPick.manager
          p.managerAvatar = userPick.managerAvatar || null
          p.isUser = true
        }
      }

      const lockedPlayerNames = new Set(
        lockedPicks.map((p: any) => p.playerName?.toLowerCase()).filter(Boolean)
      )

      let adpContext = ''
      let adpFallbackPool: { name: string; position?: string; team?: string }[] = []
      try {
        const adpType = league?.isDynasty ? 'dynasty' : 'redraft'
        const adpEntries = await getLiveADP(adpType as 'dynasty' | 'redraft', 300)
        adpFallbackPool = adpEntries.map(e => ({
          name: e.name,
          position: e.position ?? undefined,
          team: e.team ?? undefined,
        }))
        const available = adpEntries.filter(e => !lockedPlayerNames.has(e.name.toLowerCase()))
        if (available.length > 0) {
          adpContext = `\nAvailable players by ADP:\n${formatADPForPrompt(available, 60)}`
        }
      } catch {}

      const leagueFormat = `${league?.scoring || 'PPR'} ${league?.isDynasty ? 'Dynasty' : 'Redraft'}`
      const slotsToFill = picksToRedraft.map(p =>
        `#${p.overall} R${p.round}P${p.pick} — ${p.manager}${p.isUser ? ' [USER]' : ''}`
      ).join('\n')

      const aiResult = await getOrCreateAiResult({
        feature: 'mock-draft-trade-action',
        scopeType: 'league',
        scopeId: leagueId,
        provider: 'openai',
        model: 'gpt-4o-mini',
        ttlSeconds: 30 * 60,
        payload: {
          mockDraftSessionId: mock.id,
          leagueId,
          userId: session.user.id,
          sport: 'NFL',
          season: String((league as any)?.season || ''),
          draftType: String((league as any)?.draftType || ''),
          scoringFormat: String(league?.scoring || ''),
          currentPick: {
            round: Number(userPick?.round || 0),
            pick: Number(userPick?.pick || 0),
            overall: Number(pickNumber || 0),
          },
          teamNeeds: [
            { manager: userPick.manager, role: 'user' },
            { manager: partnerPick.manager, role: 'partner' },
          ],
          availablePlayerIds: adpFallbackPool.slice(0, 250).map((p) => p.name),
          priorPickIds: lockedPicks.map((p: any) => p.playerId || p.playerName || null).filter(Boolean),
          slotsToRedraft: picksToRedraft.map((p) => ({ overall: p.overall, round: p.round, pick: p.pick, manager: p.manager })),
          tradeAction: {
            action,
            pickNumber,
            fromPick: proposal.fromPick,
            tradePoint,
          },
          promptVersion: 'v1',
        },
        onCacheMiss: async () => {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are an expert fantasy football draft simulator. A draft-day trade was accepted. Re-simulate all picks from pick #${tradePoint} onward with realistic ADP-based selections.

Return valid JSON:
{ "picks": [{ "overall": number, "playerName": string, "position": string, "team": string, "confidence": number, "value": number, "notes": string }] }

Rules: one entry per slot, use ADP data, no duplicates, no locked players, [USER] gets best-available, confidence 60-95.`,
              },
              {
                role: 'user',
                content: `Trade accepted in a ${leagueFormat} mock draft. "${userPick.manager}" traded pick #${pickNumber} to "${partnerPick.manager}" for pick #${proposal.fromPick}.

Locked players (before pick #${tradePoint}): ${Array.from(lockedPlayerNames).join(', ') || 'None'}

Re-simulate these ${picksToRedraft.length} slots:
${slotsToFill}
${adpContext}

Return exactly ${picksToRedraft.length} picks.`,
              },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7,
            max_tokens: 16000,
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
        console.log(`[mock-draft/trade-action] AI cache hit { leagueId: '${leagueId}', pickNumber: ${pickNumber} }`)
      } else {
        console.log(`[mock-draft/trade-action] AI cache miss { leagueId: '${leagueId}', pickNumber: ${pickNumber}, modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
        console.log(`[mock-draft/trade-action] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
      }

      const content = aiResult.row.resultText
      if (!content) {
        return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
      }

      const parsed = JSON.parse(content)
      const aiPicks: any[] = parsed?.picks || []
      const aiPickMap = new Map<number, any>()
      for (const ap of aiPicks) {
        if (ap.overall) aiPickMap.set(ap.overall, ap)
      }

      const usedPlayers = new Set(lockedPlayerNames)

      for (const slot of picksToRedraft) {
        const aiPick = aiPickMap.get(slot.overall)
        if (aiPick?.playerName && !usedPlayers.has(aiPick.playerName.toLowerCase())) {
          slot.playerName = aiPick.playerName
          slot.position = aiPick.position || slot.position
          slot.team = aiPick.team || slot.team
          slot.confidence = aiPick.confidence || 75
          slot.value = aiPick.value || slot.value
          slot.notes = aiPick.notes || ''
          usedPlayers.add(aiPick.playerName.toLowerCase())
        } else {
          const fallback = adpFallbackPool.find(f => !usedPlayers.has(f.name.toLowerCase()))
          if (fallback) {
            slot.playerName = fallback.name
            slot.position = fallback.position || slot.position
            slot.team = fallback.team || slot.team
            slot.confidence = 65
            slot.value = slot.value || 50
            slot.notes = 'ADP fallback'
            usedPlayers.add(fallback.name.toLowerCase())
          }
        }
      }

      updatedResults = [...lockedPicks, ...picksToRedraft].sort((a, b) => a.overall - b.overall)

      const seen = new Set<string>()
      for (const slot of updatedResults) {
        const key = slot.playerName?.toLowerCase()
        if (key && seen.has(key)) {
          const fallback = adpFallbackPool.find(
            f => !seen.has(f.name.toLowerCase()) && !lockedPlayerNames.has(f.name.toLowerCase())
          )
          if (fallback) {
            slot.playerName = fallback.name
            slot.position = fallback.position || slot.position
            slot.team = fallback.team || slot.team
            slot.notes = 'Dedup fallback'
          }
        }
        if (slot.playerName) seen.add(slot.playerName.toLowerCase())
      }
    }

    const newDraft = await prisma.mockDraft.create({
      data: {
        leagueId,
        userId: session.user.id,
        rounds: mock.rounds,
        results: updatedResults,
        proposals: [],
      },
    })

    return NextResponse.json({ updatedDraft: updatedResults, draftId: newDraft.id })
  } catch (err: any) {
    console.error('[trade-action] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
