import type { FaabBidPlan } from '@/lib/chimmy/tools/faabBidTool'
import { verifiedHandoff } from '@/lib/core-app/platformLinks'
import { tradeDecisionAction } from './tradeDecisionRecommendation'
import type { ReadyChimmyScenario, ReadyStartSitScenario } from './tradeScenarioTypes'
import {
  FAAB_CARD_MAX_BIDS,
  SUPERSEDING_TOOLS,
  answerKey,
  type ChimmyFaabCard,
  type ChimmyVerdict,
} from './answerPolish'

/**
 * Builds the answer-polish wire shapes (`answerPolish.ts`) from ENGINE results, on the server.
 * Pure: no I/O. Every function here reads a typed engine outcome; none of them reads answer text.
 */

/**
 * The start/sit call, as the engine made it. `renderDecisionScenario`'s opening sentence reads this
 * too, so the chip and the sentence under it are one rule.
 */
export type StartSitCall = { call: 'start'; name: string } | { call: 'start_both' } | { call: 'sit_both' }

export function startSitCall(s: ReadyStartSitScenario): StartSitCall {
  const pick = s.options.find((p) => p.playerId === s.startPlayerId)
  if (s.contested && pick) return { call: 'start', name: pick.name }
  return s.options.every((p) => p.inBestLineup) ? { call: 'start_both' } : { call: 'sit_both' }
}

/**
 * The verdict of a READY decision-lane scenario, or null where the engine states none.
 *
 * - trade: the action `tradeDecisionRecommendation` leads with (YES / NO / HOLD / COUNTER).
 * - start/sit: START <pick>, START BOTH or SIT BOTH.
 * - waiver add/drop: none. The card compares one week and says it "does not authorize a claim";
 *   a chip would claim a decision the engine deliberately does not make.
 */
export function scenarioVerdict(s: ReadyChimmyScenario): ChimmyVerdict | null {
  if (s.kind === 'waiver') return null
  if (s.kind === 'start_sit') {
    const c = startSitCall(s)
    return { key: c.call, source: 'lineup_engine', detail: c.call === 'start' ? c.name : null }
  }
  const action = tradeDecisionAction(s)
  if (action === 'withheld') return null
  const key = action === 'accept' ? 'yes' : action === 'decline' ? 'no' : action
  return { key, source: 'trade_engine', detail: null }
}

/** "Should I trade for X?" — the trade-target engine's yes / no. */
export function tradeTargetVerdict(verdict: 'yes' | 'no', targetName: string | null): ChimmyVerdict {
  return { key: verdict, source: 'trade_engine', detail: targetName?.trim() ? targetName.trim().slice(0, 80) : null }
}

/**
 * The bid plan's verdict: `save` → HOLD, `bid` → BID. Nothing else has one — `rank` is an ordinary
 * league where the plan deliberately gives no dollars, and `no_pool` / `no_calc` / a refusal decided
 * nothing.
 */
export function faabPlanVerdict(plan: FaabBidPlan): ChimmyVerdict | null {
  if (plan.status !== 'ok') return null
  if (plan.outcome === 'save') return { key: 'hold', source: 'faab_plan', detail: 'Save your FAAB' }
  if (plan.outcome === 'bid') return { key: 'bid', source: 'faab_plan', detail: null }
  return null
}

/**
 * The plan as a card, top `FAAB_CARD_MAX_BIDS`. Null when the plan decided nothing a card could show.
 *
 * The waiver link is the platform's VERIFIED waiver screen for this league (`verifiedHandoff`), or
 * nothing — a native league, an unverified format or a missing platform id get no button rather
 * than a homepage.
 */
export function faabCardFromPlan(plan: FaabBidPlan, leagueId: string): ChimmyFaabCard | null {
  if (plan.status !== 'ok') return null
  if (plan.outcome !== 'save' && plan.outcome !== 'bid' && plan.outcome !== 'rank') return null
  const listed = plan.outcome === 'save' ? [] : plan.upgrades.slice(0, FAAB_CARD_MAX_BIDS)
  if (plan.outcome !== 'save' && listed.length === 0) return null
  const link = verifiedHandoff(
    { id: leagueId, platform: plan.platform, platformLeagueId: plan.platformLeagueId, name: plan.leagueName },
    'waivers',
  )
  return {
    version: 1,
    leagueName: plan.leagueName,
    outcome: plan.outcome,
    elimination: plan.elimination,
    remaining: plan.remaining,
    seasonBudget: plan.seasonBudget,
    lineupAssumed: plan.seatsLabel == null,
    valuesAsOf: plan.valuesAsOf,
    bids: listed.map((b) => ({
      name: b.name,
      position: b.position,
      ceiling: plan.outcome === 'bid' ? b.ceiling : null,
      sharePct: Math.round(b.shareOfSupply * 100),
      displacedName: b.displacedName,
    })),
    moreCount: plan.outcome === 'save' ? 0 : Math.max(0, plan.upgrades.length - listed.length),
    nonUpgrades: plan.nonUpgrades,
    pricedCount: plan.pricedCount,
    waiverLink: link ? { href: link.href, label: `Open waivers on ${link.platformLabel}` } : null,
  }
}

/** The superseding-tool runs of one answer, as `meta.answerKeys`. */
export function answerKeysFrom(runs: ReadonlyArray<{ tool: string; leagueId: string }>): string[] {
  const tools = new Set<string>(SUPERSEDING_TOOLS)
  const out: string[] = []
  for (const r of runs) {
    if (!tools.has(r.tool) || !r.leagueId) continue
    const key = answerKey(r.tool, r.leagueId)
    if (!out.includes(key)) out.push(key)
  }
  return out
}
