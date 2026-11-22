import 'server-only'

import { prisma } from '@/lib/prisma'
import { evaluateStoredTrade } from '@/lib/decision-os/trade/evaluateStoredTrade'
import type { LoadedTradeAsset, TradeRef } from '@/lib/decision-os/trade/tradeRecord'
import { runTradeConsoleAnalysis } from '@/lib/trade-value-console/runTradeConsoleAnalysis'
import type { TradeAssetInput, TradeConsoleAnalyzeInput } from '@/lib/trade-value-console/types'
import type { EvaluatedCounterOffer } from '@/lib/trade-value-console/counterOffers'
import { resolveCoreDepth } from '@/lib/core-app/corePaywall'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { rosterIdMapKeys } from '@/lib/core-app/rosterIdMatch'
import { listPendingOfferRefs } from '@/lib/chimmy-trade/pendingTradeDecisionGrounding'

/**
 * COUNTER-OFFERS FOR AN OFFER WAITING ON THE USER (Trade OS, owner's decision 2026-11-16: "grade + suggest
 * counters").
 *
 * 🛑 ONE COUNTER ENGINE. The Trade Center already finds counters: `evaluateCounterOffers` shortlists a player
 * from the other roster by market price, then re-grades the WHOLE package with the league's own grader. This
 * module runs that same analysis (`runTradeConsoleAnalysis`, no AI write-up) on the stored offer from the user's
 * side, so a counter Chimmy names is the counter the Trade Center would show for the same deal.
 *
 * ⚠ ONLY "ASK FOR MORE". A received offer that already grades even or in the user's favour needs no counter;
 * the engine's "offer more" branch is the right advice when BUILDING a deal, not when answering one.
 *
 * ⚠ AF PRO DEPTH. Counters are on the trade-depth list (`lib/trade-value-console/tradeAnalysisDepth.ts`), locked
 * in the Trade Center for a free user after the paywall starts. Chimmy holds the same line: it names the plan,
 * never a link (no web offers in the iOS app), and is told not to invent a counter of its own.
 *
 * ⚠ AllFantasy NEVER SENDS ONE. A suggestion is text; the user sends a counter themselves — in AllFantasy's Trade
 * Center for a native offer, on Sleeper for a Sleeper one.
 */

const MAX_COUNTERS = 3

export type PendingCounterDeps = {
  depth: (userId: string) => Promise<CoreDepthAccess>
  evaluate: typeof evaluateStoredTrade
  analyze: typeof runTradeConsoleAnalysis
  /** The other team's `LeagueTeam.externalId` — the id space the analysis resolves a counterparty in. */
  opponentExternalId: (leagueId: string, side: { teamId: string; rosterId: string | null }, source: string) => Promise<string | null>
  pendingRefs: (leagueId: string, userId: string) => Promise<TradeRef[]>
}

export function toConsoleInput(a: LoadedTradeAsset): TradeAssetInput {
  if (a.kind === 'player') {
    const sleeperId = a.identity?.sleeperId ?? (a.idSpace === 'sleeper' ? a.playerId : undefined)
    return {
      kind: 'player',
      name: a.name,
      ...(sleeperId ? { providerIdentity: { provider: 'sleeper' as const, id: sleeperId, ...(a.position ? { position: a.position } : {}) } } : {}),
    }
  }
  if (a.kind === 'pick') return { kind: 'pick', year: a.season, round: a.round, label: a.label, ...(a.draftSide ? { draftSide: a.draftSide } : {}) }
  return { kind: 'faab', amount: a.amount }
}

const refId = (ref: TradeRef) => (ref.kind === 'af' ? ref.tradeId : ref.kind === 'redraft' ? ref.proposalId : ref.providerTradeId)

async function defaultOpponentExternalId(
  leagueId: string,
  side: { teamId: string; rosterId: string | null },
  source: string,
): Promise<string | null> {
  if (source === 'provider') {
    const team = await prisma.leagueTeam.findFirst({ where: { leagueId, externalId: { in: rosterIdMapKeys(side.teamId) } }, select: { externalId: true } })
    return team?.externalId ?? null
  }
  if (!side.rosterId) return null
  const roster = await prisma.roster.findFirst({ where: { id: side.rosterId, leagueId }, select: { platformUserId: true } })
  const owner = roster?.platformUserId ?? null
  const team = await prisma.leagueTeam.findFirst({
    where: {
      leagueId,
      OR: [{ externalId: side.rosterId }, ...(owner ? [{ externalId: owner }, { claimedByUserId: owner }] : [])],
    },
    select: { externalId: true },
  })
  return team?.externalId ?? null
}

const defaultDeps: PendingCounterDeps = {
  depth: (userId) => resolveCoreDepth(userId, 'trade_depth'),
  evaluate: evaluateStoredTrade,
  analyze: runTradeConsoleAnalysis,
  opponentExternalId: defaultOpponentExternalId,
  pendingRefs: listPendingOfferRefs,
}

function counterLine(c: EvaluatedCounterOffer, give: string, get: string): string {
  const g = c.grade
  return (
    `- Ask for ${c.name}${c.position ? ` (${c.position})` : ''} too: you send [${give}], you receive [${get}, ${c.name}]. ` +
    `AllFantasy grade with it: you ${g.letter} — ${g.label}; league value you send ${g.giveValue.toLocaleString()}, you receive ${g.getValue.toLocaleString()}` +
    `${c.balanced ? ' (about even).' : ` (${Math.abs(g.percentDiff)}% apart).`}`
  )
}

/**
 * Counter-offers for one offer awaiting this user, as a block for Chimmy. `offerId` is the id printed beside the
 * offer in the pending-trades block; only an offer actually waiting on this user is accepted.
 */
export async function buildPendingCounterOffers(
  args: { leagueId: string; userId: string; offerId: string },
  deps: Partial<PendingCounterDeps> = {},
): Promise<string> {
  const d: PendingCounterDeps = { ...defaultDeps, ...deps }
  const offerId = args.offerId.trim()
  if (!offerId) return 'COUNTER-OFFERS: name the offer — use the id shown beside it in the pending trades.'

  const access = await d.depth(args.userId).catch(() => null)
  if (!access?.unlocked) {
    return (
      `COUNTER-OFFERS: part of ${access?.planName ?? 'AF Pro'} (${access?.label ?? 'trade depth'}). This user does not have it. ` +
      'Say so plainly and that the grade above is free. Do NOT suggest a counter of your own, and do not include a link.'
    )
  }

  const refs = await d.pendingRefs(args.leagueId, args.userId).catch(() => null)
  if (refs === null) return 'COUNTER-OFFERS: the trade inbox could not be read just now. Do not suggest a counter of your own.'
  const ref = refs.find((r) => refId(r) === offerId)
  if (!ref) return `COUNTER-OFFERS: ${offerId} is not an offer waiting on this user's answer. Do not suggest a counter of your own.`

  const r = await d.evaluate({ leagueId: args.leagueId, ref, userId: args.userId, surface: 'chimmy-counter' }).catch(() => null)
  if (!r) return 'COUNTER-OFFERS: the offer could not be evaluated just now. Do not suggest a counter of your own.'
  if (!r.ok) return `COUNTER-OFFERS: not available — ${r.refusal.reason} Do not suggest a counter of your own.`

  const me = r.trade.sideA.teamId === r.perspectiveTeamId ? r.trade.sideA : r.trade.sideB
  const them = me === r.trade.sideA ? r.trade.sideB : r.trade.sideA
  const grade = r.receipt.grade
  if (!grade.graded) return `COUNTER-OFFERS: not available — the offer is not graded (${grade.reason}). Do not suggest a counter of your own.`
  if (grade.getValue >= grade.giveValue) {
    return `COUNTER-OFFERS: none needed — the offer already grades ${grade.letter} for this user (they receive ${grade.getValue.toLocaleString()} for ${grade.giveValue.toLocaleString()}). Do not invent a counter.`
  }

  const opponent = await d.opponentExternalId(args.leagueId, them, r.trade.origin.source).catch(() => null)
  if (!opponent) return "COUNTER-OFFERS: not available — the other team's roster could not be matched. Do not suggest a counter of your own."

  const input: TradeConsoleAnalyzeInput = {
    sportFilter: 'ALL',
    leagueId: args.leagueId,
    userId: args.userId,
    strategy: 'neutral',
    teamContext: 'my_team',
    analysisTab: 'raw',
    sideGive: me.gives.map(toConsoleInput),
    sideGet: them.gives.map(toConsoleInput),
    skipAi: true,
    opponentTeamExternalId: opponent,
  }
  const out = await d.analyze(input).catch(() => null)
  if (!out || !out.ok) return 'COUNTER-OFFERS: the counter search could not run just now. Do not suggest a counter of your own.'

  const label = (assets: LoadedTradeAsset[]) =>
    assets.map((a) => (a.kind === 'player' ? a.name : a.kind === 'pick' ? a.label : `${a.amount} FAAB`)).join(', ') || 'nothing'
  const give = label(me.gives)
  const get = label(them.gives)
  const counters = (out.counterOffers ?? []).filter((c) => c.addTo === 'get').slice(0, MAX_COUNTERS)
  const answerWhere =
    r.trade.origin.source === 'provider'
      ? 'The user sends a counter on Sleeper themselves; AllFantasy cannot send it.'
      : "The user sends a counter from AllFantasy's Trade Center (Counter on the offer); AllFantasy never sends one for them."

  if (counters.length === 0) {
    return (
      `COUNTER-OFFERS for ${offerId}: none found — no single player on the other roster brings this offer closer to even. ` +
      `It grades ${grade.letter} for the user as it stands. Do not invent a counter.`
    )
  }
  return [
    `COUNTER-OFFERS for ${offerId} (the same counters the Trade Center finds; each re-graded as a whole package by the league's own grader). ` +
      `As offered: you ${grade.letter}; you send ${grade.giveValue.toLocaleString()}, you receive ${grade.getValue.toLocaleString()}.`,
    ...counters.map((c) => counterLine(c, give, get)),
    `RULES: name only these counters and their grades; never a player or a letter that is not listed here. ${answerWhere}`,
  ].join('\n')
}
