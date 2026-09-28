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

    const body = await req.json()
    const { leagueId, currentPick, direction, rounds = 18, tradePartnerPick } = body

    if (!leagueId || !currentPick || !direction) {
      return NextResponse.json({ error: 'leagueId, currentPick, and direction are required' }, { status: 400 })
    }
    if (!['up', 'down'].includes(direction)) {
      return NextResponse.json({ error: 'direction must be "up" or "down"' }, { status: 400 })
    }

    const draft = await prisma.mockDraft.findFirst({
      where: { leagueId, userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    })

    if (!draft || !Array.isArray(draft.results)) {
      return NextResponse.json({ error: 'No prior mock draft found. Run a mock draft first.' }, { status: 404 })
    }

    const originalDraft = (draft.results as any[]).map(p => ({ ...p }))
    const userPickIdx = originalDraft.findIndex((p: any) => p.overall === currentPick && p.isUser)
    if (userPickIdx === -1) {
      return NextResponse.json({ error: 'That pick is not yours or does not exist' }, { status: 400 })
    }

    const league = await prisma.league.findFirst({
      where: { id: leagueId, userId: session.user.id },
    })

    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }
    if (String((league as any).sport || 'NFL').toUpperCase() !== 'NFL') {
      return NextResponse.json(
        { error: 'Draft-day trade simulation is currently available for NFL mock drafts only.' },
        { status: 400 },
      )
    }

    let tradePartner: any

    if (tradePartnerPick) {
      const explicit = originalDraft.find((p: any) => p.overall === tradePartnerPick && !p.isUser)
      if (!explicit) {
        return NextResponse.json({ error: `Pick #${tradePartnerPick} is not a valid trade partner` }, { status: 400 })
      }
      tradePartner = { ...explicit, _idx: originalDraft.indexOf(explicit) }
    } else {
      const candidates = originalDraft
        .map((p, idx) => ({ ...p, _idx: idx }))
        .filter((p: any) => {
          if (direction === 'up') {
            return p.overall < currentPick && p.overall >= currentPick - 10 && !p.isUser
          } else {
            return p.overall > currentPick && p.overall <= currentPick + 10 && !p.isUser
          }
        })
        .sort((a: any, b: any) => direction === 'up' ? b.overall - a.overall : a.overall - b.overall)

      if (candidates.length === 0) {
        return NextResponse.json({
          error: `No viable trade partners ${direction === 'up' ? 'above' : 'below'} pick #${currentPick}`,
        }, { status: 400 })
      }

      tradePartner = candidates[0]
    }
    const partnerIdx = tradePartner._idx
    const userPick = originalDraft[userPickIdx]
    const userManager = userPick.manager
    const userAvatar = userPick.managerAvatar || null
    const partnerManager = tradePartner.manager
    const partnerAvatar = tradePartner.managerAvatar || null

    const tradePoint = Math.min(userPick.overall, tradePartner.overall)
    const lockedPicks = originalDraft.filter((p: any) => p.overall < tradePoint)
    const picksToRedraft = originalDraft
      .filter((p: any) => p.overall >= tradePoint)
      .map(p => ({ ...p }))

    for (const p of picksToRedraft) {
      if (p.overall === currentPick) {
        p.manager = partnerManager
        p.managerAvatar = partnerAvatar
        p.isUser = false
      } else if (p.overall === tradePartner.overall) {
        p.manager = userManager
        p.managerAvatar = userAvatar
        p.isUser = true
      }
    }

    const lockedPlayerNames = new Set(lockedPicks.map((p: any) => p.playerName?.toLowerCase()).filter(Boolean))

    let adpContext = ''
    try {
      const adpType = league?.isDynasty ? 'dynasty' : 'redraft'
      const adpEntries = await getLiveADP(adpType as 'dynasty' | 'redraft', 200)
      if (adpEntries.length > 0) {
        const available = adpEntries.filter(e => !lockedPlayerNames.has(e.name.toLowerCase()))
        if (available.length > 0) {
          adpContext = `\nAvailable players by ADP (use this for realistic picks):\n${formatADPForPrompt(available, 60)}`
        }
      }
    } catch {}

    const leagueFormat = `${league?.scoring || 'PPR'} ${league?.isDynasty ? 'Dynasty' : 'Redraft'}`

    const slotsToFill = picksToRedraft.map(p =>
      `#${p.overall} R${p.round}P${p.pick} — ${p.manager}${p.isUser ? ' [USER]' : ''}`
    ).join('\n')

    const systemPrompt = `You are an expert fantasy football draft simulator. After a draft-day trade, you must re-run all picks from the trade point forward with realistic player selections based on ADP data, team needs, and draft position.

Return valid JSON with this exact structure:
{
  "picks": [
    { "overall": number, "playerName": string, "position": string, "team": string, "confidence": number, "value": number, "notes": string }
  ]
}

Rules:
- Return one entry per slot in the "picks" array, matching the overall numbers provided
- Use ADP data to ground selections — earlier picks get better players
- No duplicate players — each player can only be drafted once
- Do NOT include any player already locked in before the trade
- The [USER] manager should get realistic best-available picks at their draft slots
- Confidence range: 60-95`

    const userPrompt = `A trade just happened in a ${leagueFormat} mock draft:
"${userManager}" traded pick #${currentPick} to "${partnerManager}" for pick #${tradePartner.overall}.
${direction === 'up' ? `${userManager} moved UP to get an earlier pick.` : `${userManager} moved DOWN, gaining value from a later pick position.`}

Players already locked (drafted before pick #${tradePoint}, DO NOT reuse):
${Array.from(lockedPlayerNames).join(', ') || 'None'}

Re-draft these ${picksToRedraft.length} slots from pick #${tradePoint} forward:
${slotsToFill}
${adpContext}

Return a "picks" array with exactly ${picksToRedraft.length} entries, one per slot above, using realistic ADP-based selections.`

    const aiResult = await getOrCreateAiResult({
      feature: 'mock-draft-trade-simulate',
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
          round: Number(userPick?.round || 0),
          pick: Number(userPick?.pick || 0),
          overall: Number(currentPick || 0),
        },
        direction,
        tradePartnerPick: Number(tradePartner?.overall || tradePartnerPick || 0),
        teamNeeds: [
          { manager: userManager, role: 'user' },
          { manager: partnerManager, role: 'partner' },
        ],
        availablePlayerIds: picksToRedraft.map((p) => p.playerId || p.playerName || null).filter(Boolean),
        priorPickIds: lockedPicks.map((p: any) => p.playerId || p.playerName || null).filter(Boolean),
        slotsToRedraft: picksToRedraft.map((p) => ({ overall: p.overall, round: p.round, pick: p.pick, manager: p.manager })),
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
      console.log(`[mock-draft/trade-simulate] AI cache hit { leagueId: '${leagueId}', currentPick: ${currentPick} }`)
    } else {
      console.log(`[mock-draft/trade-simulate] AI cache miss { leagueId: '${leagueId}', currentPick: ${currentPick}, modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
      console.log(`[mock-draft/trade-simulate] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
    }

    const content = aiResult.row.resultText
    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }

    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch {
      console.error('[trade-simulate] Failed to parse:', content.slice(0, 500))
      return NextResponse.json({ error: 'Invalid AI response' }, { status: 500 })
    }

    const aiPicks: any[] = parsed?.picks || []
    const aiPickMap = new Map<number, any>()
    for (const ap of aiPicks) {
      if (ap.overall) aiPickMap.set(ap.overall, ap)
    }

    let adpFallbackPool: { name: string; position?: string; team?: string }[] = []
    try {
      const adpType = league?.isDynasty ? 'dynasty' : 'redraft'
      const fallbackEntries = await getLiveADP(adpType as 'dynasty' | 'redraft', 300)
      adpFallbackPool = fallbackEntries.map(e => ({
        name: e.name,
        position: e.position ?? undefined,
        team: e.team ?? undefined,
      }))
    } catch {}

    const usedPlayers = new Set(lockedPlayerNames)

    for (const slot of picksToRedraft) {
      const aiPick = aiPickMap.get(slot.overall)
      if (aiPick && aiPick.playerName && !usedPlayers.has(aiPick.playerName.toLowerCase())) {
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
          slot.notes = 'ADP fallback selection'
          usedPlayers.add(fallback.name.toLowerCase())
        } else {
          usedPlayers.add(slot.playerName?.toLowerCase() || '')
        }
      }
    }

    const updatedDraft = [...lockedPicks, ...picksToRedraft]
    updatedDraft.sort((a, b) => a.overall - b.overall)

    const allPlayerNames = updatedDraft.map((p: any) => p.playerName?.toLowerCase()).filter(Boolean)
    const uniquePlayers = new Set(allPlayerNames)
    if (uniquePlayers.size < allPlayerNames.length) {
      const seen = new Set<string>()
      for (const slot of updatedDraft) {
        const key = slot.playerName?.toLowerCase()
        if (key && seen.has(key)) {
          const fallback = adpFallbackPool.find(f => !seen.has(f.name.toLowerCase()) && !lockedPlayerNames.has(f.name.toLowerCase()))
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

    const uniqueOveralls = new Set(updatedDraft.map((p: any) => p.overall))
    if (uniqueOveralls.size !== updatedDraft.length) {
      console.error('[trade-simulate] Duplicate overalls detected')
      return NextResponse.json({ error: 'Draft integrity error' }, { status: 500 })
    }
    if (updatedDraft.length !== originalDraft.length) {
      console.error('[trade-simulate] Length mismatch:', updatedDraft.length, 'vs', originalDraft.length)
      return NextResponse.json({ error: 'Draft integrity error' }, { status: 500 })
    }

    try {
      await prisma.mockDraft.update({
        where: { id: draft.id },
        data: { results: updatedDraft },
      })
    } catch (saveErr) {
      console.error('[trade-simulate] Failed to save:', saveErr)
    }

    return NextResponse.json({
      updatedDraft,
      tradeDescription: `${userManager} traded pick #${currentPick} to ${partnerManager} for pick #${tradePartner.overall}. All picks from #${tradePoint} onward have been re-simulated.`,
      tradedPicks: {
        userNewPick: tradePartner.overall,
        partnerNewPick: currentPick,
        partnerManager,
      },
    })
  } catch (err: any) {
    console.error('[trade-simulate] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
