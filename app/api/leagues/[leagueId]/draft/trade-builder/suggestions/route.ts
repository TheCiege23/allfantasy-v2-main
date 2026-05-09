/**
 * POST: Valid pick-swap suggestions (authoritative ownership) + optional AI ranking of a precomputed candidate set.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { getDraftSessionByLeague } from '@/lib/live-draft-engine/DraftSessionService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import {
  computeUpcomingOwnedPicks,
  resolveOverallForRoundSlot,
  type UpcomingPick,
} from '@/lib/live-draft-engine/draftPickTradeInventory'
import { getProviderStatus } from '@/lib/provider-config'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { buildDraftExecutionMetadata, evaluateAIInvocationPolicy, withTimeout } from '@/lib/draft-automation-policy'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { getCanonicalDraftState } from '@/lib/draft/getCanonicalDraftState'
import type { SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'

export const dynamic = 'force-dynamic'

type Kind = 'fair' | 'move_up' | 'move_down' | 'best_for_pick'

type ScoredPair = { give: UpcomingPick; recv: UpcomingPick; score: number; kind: Kind }

function pairsForKind(mine: UpcomingPick[], theirs: UpcomingPick[], kind: Kind): ScoredPair[] {
  const out: ScoredPair[] = []
  for (const g of mine) {
    for (const r of theirs) {
      const delta = r.overall - g.overall
      if (kind === 'move_up' && delta >= 0) continue
      if (kind === 'move_down' && delta <= 0) continue
      out.push({ give: g, recv: r, score: Math.abs(delta), kind })
    }
  }
  out.sort((a, b) => a.score - b.score)
  return out
}

function pairsForAnchor(anchor: UpcomingPick, theirs: UpcomingPick[]): ScoredPair[] {
  const out: ScoredPair[] = []
  for (const r of theirs) {
    const delta = r.overall - anchor.overall
    out.push({ give: anchor, recv: r, score: Math.abs(delta), kind: 'best_for_pick' })
  }
  out.sort((a, b) => a.score - b.score)
  return out
}

function deterministicRationale(give: UpcomingPick, recv: UpcomingPick, kind: Kind): string {
  const gl = `${give.round}.${String(give.slot).padStart(2, '0')}`
  const rl = `${recv.round}.${String(recv.slot).padStart(2, '0')}`
  if (kind === 'move_up') {
    return `Move up: send ${gl} (overall ${give.overall}) for their earlier ${rl} (overall ${recv.overall}).`
  }
  if (kind === 'move_down') {
    return `Move back: send ${gl} for their later ${rl} — bank draft capital if the board falls your way.`
  }
  if (kind === 'best_for_pick') {
    return `From your ${gl}: receive ${rl} (overall gap ${Math.abs(recv.overall - give.overall)}).`
  }
  return `Balanced swap: ${gl} ↔ ${rl} (overall gap ${Math.abs(recv.overall - give.overall)}).`
}

function validateSwap(params: {
  mineRosterId: string
  partnerRosterId: string
  slotOrder: SlotOrderEntry[]
  tradedPicks: TradedPickRecord[]
  pickedOverall: Set<number>
  teamCount: number
  draftType: 'snake' | 'linear' | 'auction'
  thirdRoundReversal: boolean
  give: UpcomingPick
  recv: UpcomingPick
}): boolean {
  const giveOwner = resolvePickOwner(params.give.round, params.give.slot, params.slotOrder, params.tradedPicks)
  const recvOwner = resolvePickOwner(params.recv.round, params.recv.slot, params.slotOrder, params.tradedPicks)
  if (!giveOwner || giveOwner.rosterId !== params.mineRosterId) return false
  if (!recvOwner || recvOwner.rosterId !== params.partnerRosterId) return false
  const go = resolveOverallForRoundSlot({
    round: params.give.round,
    slot: params.give.slot,
    teamCount: params.teamCount,
    draftType: params.draftType,
    thirdRoundReversal: params.thirdRoundReversal,
  })
  const ro = resolveOverallForRoundSlot({
    round: params.recv.round,
    slot: params.recv.slot,
    teamCount: params.teamCount,
    draftType: params.draftType,
    thirdRoundReversal: params.thirdRoundReversal,
  })
  if (go != null && params.pickedOverall.has(go)) return false
  if (ro != null && params.pickedOverall.has(ro)) return false
  return true
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const myRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  if (!myRosterId) return NextResponse.json({ error: 'No roster in league' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const partnerRosterId = String(body.partnerRosterId ?? body.partner_roster_id ?? '').trim()
  const suggestionKindRaw = String(body.suggestionKind ?? body.mode ?? 'fair').toLowerCase()
  const includeAi = body.includeAi !== false && body.include_ai !== false

  const anchorGiveRound = body.anchorGiveRound != null ? Math.max(1, Number(body.anchorGiveRound)) : null
  const anchorGiveSlot = body.anchorGiveSlot != null ? Math.max(1, Number(body.anchorGiveSlot)) : null

  if (!partnerRosterId || partnerRosterId === myRosterId) {
    return NextResponse.json({ error: 'Select a trade partner other than yourself.' }, { status: 400 })
  }

  const suggestionKind: Kind =
    suggestionKindRaw === 'move_up'
      ? 'move_up'
      : suggestionKindRaw === 'move_down'
        ? 'move_down'
        : suggestionKindRaw === 'best_for_pick' || suggestionKindRaw === 'for_pick'
          ? 'best_for_pick'
          : 'fair'

  const draftSession = await getDraftSessionByLeague(leagueId)
  if (!draftSession || draftSession.status !== 'in_progress') {
    return NextResponse.json({ error: 'Draft is not live.' }, { status: 400 })
  }

  const premiumTradeAi = (await new EntitlementResolver().resolveForUser(userId, 'pro_trade_ai')).hasAccess

  const rawSlotOrder = (draftSession as { slotOrder?: unknown }).slotOrder
  const slotOrder = (Array.isArray(rawSlotOrder) ? rawSlotOrder : []) as unknown as SlotOrderEntry[]
  const rawTradedPicks = (draftSession as { tradedPicks?: unknown }).tradedPicks
  const tradedPicks = (Array.isArray(rawTradedPicks) ? rawTradedPicks : []) as unknown as TradedPickRecord[]
  const picks = ((draftSession as { picks?: { overall: number }[] }).picks ?? []) as { overall: number }[]
  const pickedOverall = new Set(picks.map((p) => p.overall))
  const teamCount = Number((draftSession as { teamCount?: number }).teamCount ?? 12)
  const rounds = Number((draftSession as { rounds?: number }).rounds ?? 15)
  const totalPicks = Math.max(1, teamCount * rounds)
  const draftType = ((draftSession as { draftType?: string }).draftType ?? 'snake') as 'snake' | 'linear' | 'auction'
  const thirdRoundReversal = Boolean((draftSession as { thirdRoundReversal?: boolean }).thirdRoundReversal)

  const baseParams = {
    totalPicks,
    pickedOverall,
    teamCount,
    draftType,
    thirdRoundReversal,
    slotOrder,
    tradedPicks,
  }

  const mine = computeUpcomingOwnedPicks({ ...baseParams, ownerRosterId: myRosterId })
  const theirs = computeUpcomingOwnedPicks({ ...baseParams, ownerRosterId: partnerRosterId })

  if (mine.length === 0 || theirs.length === 0) {
    return NextResponse.json({
      ok: true,
      suggestions: [],
      emptyReason: 'No upcoming tradable picks found for one or both sides (may already be on the clock or traded).',
      aiUsed: false,
      suggestionSource: 'deterministic',
    })
  }

  const validateArgs = {
    mineRosterId: myRosterId,
    partnerRosterId,
    slotOrder,
    tradedPicks,
    pickedOverall,
    teamCount,
    draftType,
    thirdRoundReversal,
  }

  let candidatePairs: ScoredPair[] = []

  if (suggestionKind === 'best_for_pick') {
    if (anchorGiveRound == null || anchorGiveSlot == null || !Number.isFinite(anchorGiveRound) || !Number.isFinite(anchorGiveSlot)) {
      return NextResponse.json({ error: 'best_for_pick requires anchorGiveRound and anchorGiveSlot.' }, { status: 400 })
    }
    const anchor = mine.find((p) => p.round === anchorGiveRound && p.slot === anchorGiveSlot)
    if (!anchor) {
      return NextResponse.json({
        ok: true,
        suggestions: [],
        emptyReason: 'That pick is not in your upcoming tradable inventory for this draft state.',
        aiUsed: false,
        suggestionSource: 'deterministic',
      })
    }
    candidatePairs = pairsForAnchor(anchor, theirs).slice(0, 40)
  } else {
    const kinds: Kind[] =
      suggestionKind === 'move_up' || suggestionKind === 'move_down' || suggestionKind === 'fair'
        ? [suggestionKind]
        : ['fair', 'move_up', 'move_down']

    const seen = new Set<string>()
    for (const k of kinds) {
      for (const row of pairsForKind(mine, theirs, k).slice(0, 18)) {
        const key = `${row.give.overall}-${row.recv.overall}-${row.kind}`
        if (seen.has(key)) continue
        seen.add(key)
        candidatePairs.push(row)
      }
    }
    candidatePairs.sort((a, b) => a.score - b.score)
    candidatePairs = candidatePairs.slice(0, 40)
  }

  const validated: Array<ScoredPair & { id: string }> = []
  for (const row of candidatePairs) {
    if (!validateSwap({ ...validateArgs, give: row.give, recv: row.recv })) continue
    validated.push({
      ...row,
      id: `${row.kind}-${row.give.round}-${row.give.slot}-${row.recv.round}-${row.recv.slot}`,
    })
    if (validated.length >= 24) break
  }

  if (validated.length === 0) {
    return NextResponse.json({
      ok: true,
      suggestions: [],
      emptyReason: 'No valid swaps found after ownership checks (board may have advanced). Try again.',
      aiUsed: false,
      suggestionSource: 'deterministic',
    })
  }

  const canonicalDraftState = await getCanonicalDraftState({
    leagueId,
    draftId: draftSession.id,
  })
  const ctxPicksMade = canonicalDraftState?.picksMade ?? (picks.length || 0)
  const currentPick = canonicalDraftState?.nextPick?.overall != null
    ? {
        overall: canonicalDraftState.nextPick.overall,
        round: canonicalDraftState.nextPick.round ?? 1,
        slot: canonicalDraftState.nextPick.slot ?? 1,
      }
    : null
  const modeHint =
    suggestionKind === 'move_up'
      ? 'Prioritize trades that improve draft position soon without massive overpay.'
      : suggestionKind === 'move_down'
        ? 'Prioritize trades that add value if moving back (balanced overall gap).'
        : suggestionKind === 'best_for_pick'
          ? 'Focus on realistic returns for the anchored pick the user is offering.'
          : 'Prefer roughly fair overall swaps unless a clear tactical edge exists.'

  const candidatesPayload = validated.map((row, candidateIndex) => ({
    candidateIndex,
    suggestionKind: row.kind,
    give: { round: row.give.round, slot: row.give.slot, overall: row.give.overall },
    receive: { round: row.recv.round, slot: row.recv.slot, overall: row.recv.overall },
    overallDelta: row.recv.overall - row.give.overall,
    deterministicHint: deterministicRationale(row.give, row.recv, row.kind),
  }))

  let rankedIndices: number[] = validated.map((_, i) => i)
  let aiStrategyNotes: string | null = null
  let aiUsed = false
  let reasonCode = 'deterministic_order'

  const invocation = evaluateAIInvocationPolicy({
    feature: 'counter_trade_suggestion',
    scopeId: leagueId,
    requestAI: includeAi && premiumTradeAi,
    aiEnabled: true,
    providerAvailable: getProviderStatus().anyAi,
  })

  if (invocation.decision === 'allow_ai' && validated.length > 0) {
    const aiResult = await withTimeout(
      openaiChatJson({
        skipCache: true,
        temperature: 0.35,
        maxTokens: 900,
        messages: [
          {
            role: 'system',
            content: [
              'You rank draft pick swap proposals for a live snake/redraft fantasy draft.',
              'You MUST only reference candidates by candidateIndex from the provided list.',
              'Never invent picks, rounds, or managers.',
              'Return strict JSON: { "ranked": [ { "candidateIndex": number, "rationale": string } ], "sessionNote": string }',
              'ranked must contain up to 6 entries; candidateIndex values must exist in the list.',
              'rationale: max 2 sentences, tactical redraft/snake-aware.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              mode: suggestionKind,
              modeHint,
              draft: {
                leagueId,
                draftType,
                thirdRoundReversal,
                teamCount,
                rounds,
                picksMade: ctxPicksMade,
                approximateNextOverall: ctxPicksMade + 1,
                currentPick: currentPick
                  ? { overall: currentPick.overall, round: currentPick.round, slot: currentPick.slot }
                  : null,
              },
              candidates: candidatesPayload,
            }),
          },
        ],
      }),
      invocation.maxLatencyMs,
    )

    if (!aiResult.ok) {
      reasonCode = 'ai_timeout_deterministic_fallback'
    } else if (!aiResult.value.ok) {
      reasonCode = 'ai_error_deterministic_fallback'
    } else {
      const parsed = parseJsonContentFromChatCompletion(aiResult.value.json) as {
        ranked?: Array<{ candidateIndex?: number; rationale?: string }>
        sessionNote?: string
      } | null
      const rankedRaw = Array.isArray(parsed?.ranked) ? parsed!.ranked! : []
      const nextIdx: number[] = []
      const used = new Set<number>()
      for (const row of rankedRaw) {
        const idx = Number(row?.candidateIndex)
        if (!Number.isFinite(idx) || idx < 0 || idx >= validated.length || used.has(idx)) continue
        used.add(idx)
        nextIdx.push(idx)
      }
      if (nextIdx.length > 0) {
        rankedIndices = [...nextIdx, ...validated.map((_, i) => i).filter((i) => !used.has(i))]
        aiUsed = true
        reasonCode = 'ai_ranked_candidates'
        if (typeof parsed?.sessionNote === 'string' && parsed.sessionNote.trim()) {
          aiStrategyNotes = parsed.sessionNote.trim().slice(0, 600)
        }
        for (const row of rankedRaw) {
          const idx = Number(row?.candidateIndex)
          const rationale = typeof row?.rationale === 'string' ? row.rationale.trim() : ''
          if (!Number.isFinite(idx) || idx < 0 || idx >= validated.length || !rationale) continue
          const target = validated[idx]
          ;(target as unknown as { aiRationale?: string }).aiRationale = rationale.slice(0, 500)
        }
      } else {
        reasonCode = 'ai_parse_fallback'
      }
    }
  } else if (!premiumTradeAi && includeAi) {
    reasonCode = 'entitlement_deterministic_only'
  } else if (invocation.decision !== 'allow_ai') {
    reasonCode = invocation.reasonCode
  }

  const ordered = rankedIndices.map((i) => validated[i]).filter(Boolean)
  const suggestions = ordered.slice(0, 6).map((row) => {
    const aiRationale = (row as unknown as { aiRationale?: string }).aiRationale
    return {
      id: row.id,
      suggestionKind: row.kind,
      giveRound: row.give.round,
      giveSlot: row.give.slot,
      receiveRound: row.recv.round,
      receiveSlot: row.recv.slot,
      rationale:
        typeof aiRationale === 'string' && aiRationale.length > 0
          ? aiRationale
          : deterministicRationale(row.give, row.recv, row.kind),
      aiEnhanced: Boolean(aiRationale && aiRationale.length > 0),
    }
  })

  return NextResponse.json({
    ok: true,
    suggestions,
    mineCount: mine.length,
    theirsCount: theirs.length,
    aiUsed,
    suggestionSource: aiUsed ? 'ai_ranked' : 'deterministic',
    aiStrategyNotes,
    execution: buildDraftExecutionMetadata({
      feature: 'counter_trade_suggestion',
      aiUsed,
      aiEligible: invocation.canShowAIButton,
      reasonCode,
      fallbackToDeterministic: includeAi && !aiUsed && invocation.decision !== 'deny_dead_button',
    }),
  })
}
