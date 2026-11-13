/**
 * Demo trade evaluator: value two sides of a hypothetical trade between demo teams.
 *
 * Uses the same market chart the real evaluator prices from (FantasyCalc via the
 * DB-first read-through cache — a cold cache costs one sanctioned fetch, never a call per
 * request) and the adapter's own pure `compareTradeValues`. Nothing is saved, no trade is
 * proposed, no notification goes anywhere: it is arithmetic over two lists of names.
 *
 * Only players actually on a demo roster can be chosen, so the endpoint cannot be used
 * as a free general-purpose valuation API.
 */
import 'server-only'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { compareTradeValues, type FantasyCalcSettings } from '@/lib/fantasycalc'
import type { DemoLeagueView } from './types'

type DemoTradeVerdict = {
  demo: true
  sideA: { slot: number; total: number; players: Array<{ name: string; value: number }> }
  sideB: { slot: number; total: number; players: Array<{ name: string; value: number }> }
  percentDiff: number
  winnerSlot: number | null
  summary: string
}

function settingsFor(view: DemoLeagueView): FantasyCalcSettings {
  const pos = view.settings.rosterPositions
  const superflex = pos.some((p) => p === 'SUPER_FLEX' || p === 'SF' || p === 'OP') || pos.filter((p) => p === 'QB').length >= 2
  const label = view.settings.scoringLabel
  return {
    isDynasty: view.settings.isDynasty,
    numQbs: superflex ? 2 : 1,
    numTeams: Math.min(Math.max(view.settings.teamCount || 12, 8), 16),
    ppr: label === 'Half PPR' ? 0.5 : label === 'Standard' ? 0 : 1,
  }
}

type DemoTradeInput = { slotA: number; slotB: number; giveA: string[]; giveB: string[] }

export async function evaluateDemoTrade(
  view: DemoLeagueView,
  input: DemoTradeInput,
): Promise<{ ok: true; verdict: DemoTradeVerdict } | { ok: false; status: number; error: string }> {
  if (view.settings.sport !== 'NFL') return { ok: false, status: 422, error: 'The demo trade evaluator prices NFL leagues only.' }
  if (input.slotA === input.slotB) return { ok: false, status: 400, error: 'Pick two different teams.' }
  const rosterA = view.rosters.find((r) => r.slot === input.slotA)
  const rosterB = view.rosters.find((r) => r.slot === input.slotB)
  if (!rosterA || !rosterB) return { ok: false, status: 400, error: 'Unknown team.' }

  const namesOf = (r: typeof rosterA) => new Set([...r.starters, ...r.bench].map((p) => p.name))
  const onA = namesOf(rosterA)
  const onB = namesOf(rosterB)
  const giveA = [...new Set(input.giveA)].filter((n) => onA.has(n)).slice(0, 6)
  const giveB = [...new Set(input.giveB)].filter((n) => onB.has(n)).slice(0, 6)
  if (giveA.length === 0 || giveB.length === 0) return { ok: false, status: 400, error: 'Choose at least one player from each team.' }

  let players
  try {
    players = await getFantasyCalcValuesDbFirst(settingsFor(view))
  } catch {
    return { ok: false, status: 503, error: 'Market values are unavailable right now.' }
  }
  // Side A GIVES giveA and RECEIVES giveB, so its incoming value is giveB.
  const cmp = compareTradeValues(players, giveB, giveA)
  const teamName = (slot: number) => view.teams.find((t) => t.slot === slot)?.teamName ?? `Team ${slot}`
  const winnerSlot = cmp.winner === 'A' ? input.slotA : cmp.winner === 'B' ? input.slotB : null
  const summary = winnerSlot == null
    ? `Close to even — within ${cmp.percentDiff}% on current market value.`
    : `${teamName(winnerSlot)} comes out ahead by about ${cmp.percentDiff}% on current market value.`

  return {
    ok: true,
    verdict: {
      demo: true,
      sideA: { slot: input.slotA, total: Math.round(cmp.sideATotal), players: cmp.sideABreakdown.map((p) => ({ name: p.name, value: Math.round(p.value) })) },
      sideB: { slot: input.slotB, total: Math.round(cmp.sideBTotal), players: cmp.sideBBreakdown.map((p) => ({ name: p.name, value: Math.round(p.value) })) },
      percentDiff: cmp.percentDiff,
      winnerSlot,
      summary,
    },
  }
}
