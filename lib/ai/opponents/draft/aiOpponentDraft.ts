/**
 * Deterministic draft decisions for AI opponents — no network calls.
 * Callers must supply ADP/tier-enriched player rows from your draft board.
 */

import type { BotProfile, DraftDecisionContext, DraftPickDecision, DraftPlayerOption } from "../types"
import { applyNpcPersonalityScoreAdjustment } from "@/lib/live-draft-engine/npcDraftPersonality"

function adpValue(p: DraftPlayerOption): number {
  if (p.adp != null && p.adp > 0) return Math.max(1, 200 - p.adp)
  if (p.tier != null) return Math.max(1, 50 - p.tier * 3)
  return 30
}

function needBonus(bot: BotProfile, p: DraftPlayerOption, rosterCounts: Record<string, number>, round: number): number {
  const pos = normalizePos(p.position)
  const startersWant = defaultStarterTargets(pos, rosterCounts, round)
  let bonus = startersWant * 4
  const w = bot.tendencies
  if (pos === "RB") {
    bonus += w.heroRbWeight * (round <= 3 ? 8 : round <= 8 ? 4 : 0)
    bonus -= w.zeroRbWeight * (round <= 5 ? 6 : 0)
  }
  if (pos === "WR") bonus += w.zeroRbWeight * (round <= 4 ? 5 : 0)
  if (pos === "QB") bonus += w.qbEarlyWeight * (round <= 6 ? 6 : 0)
  if (pos === "TE") bonus += w.tePremiumWeight * (round <= 7 ? 5 : 0)
  if (p.isRookie) bonus += w.rookieAppetite * 3 + w.devyWeight * 2
  return bonus
}

function normalizePos(raw: string): string {
  const u = raw.toUpperCase()
  if (u.includes("QB")) return "QB"
  if (u.includes("RB")) return "RB"
  if (u.includes("WR")) return "WR"
  if (u.includes("TE")) return "TE"
  return "FL"
}

/** Rough “still need starters” signal from current roster counts */
function defaultStarterTargets(pos: string, rosterCounts: Record<string, number>, round: number): number {
  const c = rosterCounts[pos] ?? 0
  const phase = round <= 5 ? 1 : 0
  const targets: Record<string, number> = { RB: 2 + phase, WR: 3, TE: 1, QB: 1, FL: 0 }
  const want = targets[pos] ?? 1
  return Math.max(0, want - c)
}

function reachNoise(bot: BotProfile, playerId: string, overall: number): number {
  const chaos = bot.tendencies.chaosReach * 12
  const h = (hashString(`${bot.botId}:${playerId}:${overall}`) % 1000) / 1000
  return (h - 0.5) * chaos
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}

function filterBySport(ctx: DraftDecisionContext, pool: DraftPlayerOption[]): DraftPlayerOption[] {
  const ls = ctx.leagueSport ? String(ctx.leagueSport).toUpperCase() : null
  if (!ls) return pool
  return pool.filter((p) => !p.sport || String(p.sport).toUpperCase() === ls)
}

export function decideDraftPickWithScores(ctx: DraftDecisionContext): {
  decision: DraftPickDecision
  candidateScores: Array<{ playerId: string; score: number }>
} {
  const { bot, available, queue, overallPick, round, rosterCounts, avoidPlayerIds } = ctx
  const avoid = new Set(avoidPlayerIds ?? [])

  if (queue.length > 0) {
    const first = queue.find((id) => available.some((a) => a.playerId === id))
    if (first) {
      return {
        decision: {
          playerId: first,
          reason: "Top eligible player on queue",
          confidence: 0.92,
        },
        candidateScores: [],
      }
    }
  }

  const sportFiltered = filterBySport(ctx, available)
  const pool = sportFiltered.length > 0 ? sportFiltered : available

  if (pool.length === 0) {
    throw new Error("decideDraftPick: no available players")
  }

  const scored: Array<{ p: DraftPlayerOption; score: number }> = []

  for (const p of pool) {
    if (avoid.has(p.playerId)) continue
    const base = adpValue(p) * (0.55 + bot.tendencies.floorVsUpside * 0.15)
    const need = needBonus(bot, p, rosterCounts, round)
    const reach = reachNoise(bot, p.playerId, overallPick)
    const avoidPen = avoid.has(p.playerId) ? -200 : 0
    const parts = { base, need, reach }
    const npcAdj = ctx.npcDraftPersonality
      ? applyNpcPersonalityScoreAdjustment(ctx, p, parts)
      : 0
    const score = base + need + reach + avoidPen + npcAdj
    scored.push({ p, score })
  }

  scored.sort((a, b) => b.score - a.score)
  let best = scored[0]?.p ?? null
  if (!best) best = pool[0]!

  const npc = ctx.npcDraftPersonality ? ` [NPC:${ctx.npcDraftPersonality}]` : ""
  return {
    decision: {
      playerId: best.playerId,
      reason: `Value + roster fit (round ${round}); ADP-weighted${npc}`,
      confidence: 0.72,
    },
    candidateScores: scored.map((s) => ({ playerId: s.p.playerId, score: s.score })),
  }
}

export function decideDraftPick(ctx: DraftDecisionContext): DraftPickDecision {
  return decideDraftPickWithScores(ctx).decision
}

export function suggestPreDraftQueue(
  bot: BotProfile,
  players: DraftPlayerOption[],
  limit: number
): string[] {
  const ranked = [...players].sort((a, b) => {
    const sa = adpValue(a) + needBonus(bot, a, {}, 1)
    const sb = adpValue(b) + needBonus(bot, b, {}, 1)
    return sb - sa
  })
  return ranked.slice(0, limit).map((p) => p.playerId)
}
