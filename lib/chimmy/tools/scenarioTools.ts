import 'server-only'

import {
  buildStartSitScenario,
  buildWaiverScenario,
  renderStartSitScenarioBlock,
  renderWaiverScenarioBlock,
} from '@/lib/chimmy/lineupScenarioGrounding'
import { buildTradeScenario, renderTradeScenarioBlock } from '@/lib/chimmy/tradeScenarioGrounding'

/**
 * The push path's scenario engines, reachable from the tool loop.
 *
 * ── 🛑 THE PATH THAT ANSWERS FIRST COULD NOT GRADE A TRADE ─────────────────────────────────────
 * `buildTradeScenario`, `buildStartSitScenario` and `buildWaiverScenario` resolve a described move
 * against the caller's real rosters and price it this week under the league's own rules. They ran
 * only on the PECR push path — and the tool loop, on by default, answers first and returns early. So
 * "should I trade Chase for Jefferson" reached a model holding two market values and nothing else,
 * while a full before/after sat one code path away.
 *
 * These wrap the SAME builders; nothing is re-derived. The builders parse prose, so each tool
 * composes the canonical sentence the parser was written for from structured arguments. That is
 * deliberate: two parsers would disagree about which side a player is on.
 *
 * ⚠ NAMES ARE TITLE-CASED BEFORE COMPOSING. The name extractor matches capitalised runs, so a model
 * passing "ja'marr chase" would otherwise produce a sentence with no names in it — and an honest
 * "no trade found" for a trade that was plainly described. Matching itself goes through
 * `normalizePlayerName`, which ignores case, so the casing change cannot alter WHICH player matches.
 * Entries carrying a digit ("2027 1st") are draft picks and are passed through untouched.
 *
 * 🛑 EVERY LEAGUE ID HERE IS `ctx.leagueId` — membership-proven — and the caller checks it.
 */

const MAX_SIDE = 6

function titleCase(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ')
  if (/\d/.test(s)) return s
  return s
    .split(' ')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
}

function names(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return list
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .slice(0, MAX_SIDE)
    .map(titleCase)
}

const joinSide = (side: string[]) => side.join(' and ')

export async function runTradeScenarioTool(args: { give: unknown; get: unknown; leagueId: string; userId: string }): Promise<string> {
  const give = names(args.give)
  const get = names(args.get)
  if (give.length === 0 || get.length === 0) {
    return 'Both sides of the trade are needed: pass what the user GIVES and what they GET, each as full player names (or picks like "2027 1st"). Ask the user if either side is missing.'
  }
  const message = `${joinSide(give)} for ${joinSide(get)}`
  const scenario = await buildTradeScenario({ message, leagueId: args.leagueId, userId: args.userId })
  if (!scenario) {
    return `"${message}" could not be read as a trade between two rosters in this league. Ask for full player names on both sides; do not grade it.`
  }
  return renderTradeScenarioBlock(scenario)
}

export async function runStartSitScenarioTool(args: { players: unknown; leagueId: string; userId: string }): Promise<string> {
  const players = names(args.players)
  if (players.length !== 2) {
    return players.length > 2
      ? 'This compares exactly TWO players. For a whole-lineup question call optimize_my_lineup instead.'
      : 'Two players are needed to compare. Ask which two they are deciding between, or call optimize_my_lineup for the whole lineup.'
  }
  const scenario = await buildStartSitScenario({
    message: `start ${players[0]} or ${players[1]}`,
    leagueId: args.leagueId,
    userId: args.userId,
  })
  if (!scenario) {
    return `Neither ${players.join(' nor ')} could be matched to their roster as a start/sit choice. Ask them to check the names; do not rank the two.`
  }
  return renderStartSitScenarioBlock(scenario)
}

export async function runWaiverScenarioTool(args: { add: unknown; drop: unknown; leagueId: string; userId: string }): Promise<string> {
  const add = names(args.add)[0]
  const drop = names(args.drop)[0]
  if (!add) {
    return 'A player to ADD is needed. For "who should I pick up" call get_available_players first, then call this with the one they are considering.'
  }
  const scenario = await buildWaiverScenario({
    message: `add ${add}${drop ? ` and drop ${drop}` : ''}`,
    leagueId: args.leagueId,
    userId: args.userId,
    engineClaims: null,
  })
  if (!scenario) {
    return `The move "add ${add}${drop ? `, drop ${drop}` : ''}" could not be read. Ask them to confirm the names; do not price it.`
  }
  return renderWaiverScenarioBlock(scenario)
}
