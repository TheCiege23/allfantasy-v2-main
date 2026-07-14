/**
 * Draft Recommendation Adapter — Draft OS foundation, Phase 8.
 *
 * Wraps the ONE real, independently-computed comparison-only draft engine
 * found during the audit: lib/ai/opponents/draft/aiOpponentDraft.ts's
 * decideDraftPickWithScores() — the same engine real AI-controlled opponent
 * rosters use to autopick (base ADP-value + need + reach + personality
 * adjustment; a genuinely separate formula from RecommendationEngine's
 * ADP-edge + need fusion). This is the "T2"/"waiverRecommendationService"
 * role — comparison-only, never this shadow's own primary value.
 *
 * decideDraftPickWithScores requires a full BotProfile (personality weights).
 * Rather than inventing one, this adapter always uses the real, already-
 * defined 'balanced_builder' archetype (lib/ai/opponents/botProfiles.ts) —
 * "steady ADP with light roster-awareness; rarely reaches" — the closest
 * real neutral baseline among the ~20 defined personas, never a fabricated
 * weighting.
 *
 * Known, documented limitation: this adapter never reads a manager's real
 * saved draft queue (DraftQueueEntry) — decideDraftPickWithScores's
 * queue-first branch is therefore never exercised here, which could cause
 * spurious divergence against a manager who has queued a specific pick. Not
 * wired in this phase; comparison-only impact, never authoritative.
 */

import { decideDraftPickWithScores } from '@/lib/ai/opponents/draft/aiOpponentDraft'
import { getBotProfileByArchetype } from '@/lib/ai/opponents/botProfiles'
import type { DraftDecisionContext as OpponentDraftDecisionContext, DraftPlayerOption, DraftFormatHint } from '@/lib/ai/opponents/types'
import type { DraftDecisionContext } from './DraftContextAssembler'
import type { LegacyDraftGraderResult } from './types'

const DRAFT_TYPE_TO_FORMAT_HINT: Record<string, DraftFormatHint> = {
  snake: 'snake',
  linear: 'linear',
  rookie: 'rookie',
  rookie_draft: 'rookie',
  supplemental: 'supplemental',
  dispersal: 'dispersal',
  dynasty_startup: 'startup_dynasty',
  startup_draft: 'startup_dynasty',
}

function resolveFormatHint(draftType: string | null | undefined): DraftFormatHint {
  if (!draftType) return 'unknown'
  return DRAFT_TYPE_TO_FORMAT_HINT[draftType] ?? 'unknown'
}

export async function runLegacyDraftGrader(ctx: DraftDecisionContext): Promise<LegacyDraftGraderResult> {
  const graderId = 'ai_opponent_draft' as const
  try {
    const bot = getBotProfileByArchetype('balanced_builder')
    if (!bot) {
      return { graderId, topPlayerId: null, topPlayerName: null, confidence: null, reason: null, error: "balanced_builder archetype not found" }
    }

    const available: DraftPlayerOption[] = ctx.engineInput.available.map((p) => {
      const key = `${p.name.trim().toLowerCase()}|${p.position.trim().toLowerCase()}`
      return {
        playerId: ctx.playerIdByKey.get(key) ?? key,
        name: p.name,
        position: p.position,
        team: p.team ?? null,
        adp: p.adp ?? null,
        tier: null,
        byeWeek: p.byeWeek ?? null,
        sport: ctx.sport,
      }
    })

    if (available.length === 0) {
      return { graderId, topPlayerId: null, topPlayerName: null, confidence: null, reason: null, error: 'No available players in the assembled context.' }
    }

    const rosterCounts: Record<string, number> = {}
    for (const player of ctx.engineInput.teamRoster) {
      rosterCounts[player.position] = (rosterCounts[player.position] ?? 0) + 1
    }

    const opponentCtx: OpponentDraftDecisionContext = {
      leagueId: ctx.leagueId,
      teamId: ctx.rosterId,
      bot,
      format: resolveFormatHint(ctx.draftType),
      scoring: null,
      isSuperflex: ctx.isSF,
      isTePremium: false,
      isDynasty: ctx.isDynasty,
      isDevy: ctx.isDevy,
      round: ctx.round,
      pickInRound: ctx.pick,
      overallPick: ctx.pick,
      rosterCounts,
      queue: [],
      available,
      leagueSport: ctx.sport,
    }

    const { decision } = decideDraftPickWithScores(opponentCtx)
    const topPlayer = available.find((p) => p.playerId === decision.playerId) ?? null

    return {
      graderId,
      topPlayerId: decision.playerId,
      topPlayerName: topPlayer?.name ?? null,
      confidence: decision.confidence,
      reason: decision.reason,
      error: null,
    }
  } catch (err) {
    return {
      graderId,
      topPlayerId: null,
      topPlayerName: null,
      confidence: null,
      reason: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
