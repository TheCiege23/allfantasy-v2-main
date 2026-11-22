/**
 * Salary Cap AI prompt builders. All prompts use DETERMINISTIC context only.
 * AI must not compute cap legality, expiration, bid legality, or lottery — only explain and advise.
 * PROMPT 341 — Supported sports: NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { SalaryCapAIDeterministicContext, SalaryCapAIContextType } from './SalaryCapAIContext'

const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAF: 'NCAA Football',
  NCAAB: 'NCAA Basketball',
  SOCCER: 'Soccer',
}

function sportLabel(sport: string): string {
  return SPORT_LABELS[sport] ?? sport
}

function contextSummary(ctx: SalaryCapAIDeterministicContext): string {
  const lines = [
    `League: ${ctx.leagueId}. Sport: ${sportLabel(ctx.sport)}. Mode: ${ctx.mode}. Cap year: ${ctx.capYear}.`,
    `Config: startup cap $${ctx.config.startupCap}, growth ${ctx.config.capGrowthPercent}%, contract years ${ctx.config.contractMinYears}-${ctx.config.contractMaxYears}, rookie years ${ctx.config.rookieContractYears}, holdback $${ctx.config.auctionHoldback}.`,
    `Extensions: ${ctx.config.extensionsEnabled}. Franchise tag: ${ctx.config.franchiseTagEnabled}.`,
  ]
  if (ctx.ledger) {
    lines.push(
      `My cap: space $${ctx.ledger.capSpace}, committed $${ctx.ledger.totalCapHit}, dead money $${ctx.ledger.deadMoneyHit}, rollover used $${ctx.ledger.rolloverUsed}.`
    )
  }
  lines.push(
    `Contracts: ${ctx.contracts.length} active. Expiring: ${ctx.expiringCount}. Extension candidates: ${ctx.extensionCandidatesCount}. Tag candidates: ${ctx.tagCandidatesCount}. Dead money: $${ctx.deadMoneyTotal}. Rookie deals: ${ctx.rookieContractCount}.`
  )
  if (ctx.futureProjection.length) {
    lines.push(
      `Future projection: ${ctx.futureProjection.map((y) => `${y.capYear}=$${y.projectedSpace} space`).join('; ')}.`
    )
  }
  return lines.join(' ')
}

function buildStartupAuctionPrompt(
  ctx: SalaryCapAIDeterministicContext
): { system: string; user: string } {
  const sport = sportLabel(ctx.sport)
  const system = `You are AllFantasy's Salary Cap League startup auction advisor. Your role is STRATEGY and EXPLANATION only.

RULES:
- Cap legality, bid validity, and contract assignment are DETERMINISTIC (league engine). You never compute or override them.
- Advise on: cap allocation strategy, nomination order, bidding discipline, stars-and-scrubs vs balanced build, contract length (short vs long) during startup.
- Use only the provided config (cap, holdback, contract min/max). Do not invent cap numbers or contract terms.
- Keep response under 350 words. Be specific and actionable.`

  const user = `${contextSummary(ctx)}

Give startup auction strategy: (1) how to allocate cap across positions, (2) nomination strategy, (3) bidding discipline (when to push vs hold), (4) stars-and-scrubs vs balanced build for ${sport} salary cap, (5) contract length guidance (when to go 1–2 years vs 3–4). Use only the data above.`

  return { system, user }
}

function buildCapHealthPrompt(
  ctx: SalaryCapAIDeterministicContext
): { system: string; user: string } {
  const system = `You are AllFantasy's Salary Cap League cap health advisor. Your role is EXPLANATION and RECOMMENDATION only.

RULES:
- All cap numbers, legality, and contract status are DETERMINISTIC. You never calculate or change them.
- Review cap health: flexibility, dead money impact, expiring deals, extension/tag decisions. Suggest priorities (extend, cut, trade, conserve).
- Do not invent contract or cap figures. Use only the provided context.
- Keep response under 300 words.`

  const user = `${contextSummary(ctx)}

${ctx.contracts.length ? `Top contracts by salary: ${ctx.contracts.slice(0, 8).map((c) => `${c.playerName ?? 'Player'} $${c.salary} (${c.yearsRemaining} yr left)`).join('; ')}.` : ''}

Provide: (1) cap health summary, (2) main risks (dead money, expirations), (3) extension/cut/trade priorities, (4) whether to conserve cap or push. Use only the data above.`

  return { system, user }
}

function buildExtensionTagPrompt(
  ctx: SalaryCapAIDeterministicContext
): { system: string; user: string } {
  const system = `You are AllFantasy's Salary Cap League extension and franchise tag advisor. Your role is RECOMMENDATION and EXPLANATION only.

RULES:
- Extension eligibility and tag eligibility are DETERMINISTIC (league engine). You never compute or override them.
- Recommend who to extend vs let walk, fair extension price, and whether to use the franchise tag. Explain restructure/cut consequences in words only.
- Do not invent eligibility or dollar amounts. Use only the provided context.
- Keep response under 300 words.`

  const user = `${contextSummary(ctx)}

${ctx.contracts.length ? `Expiring / extension candidates (final year): ${ctx.contracts.filter((c) => c.yearsRemaining <= 0 || c.contractYear >= c.yearsTotal).map((c) => `${c.playerName ?? 'Player'} $${c.salary}`).join('; ') || 'None'}.` : ''}

Provide: (1) extension recommendations (who to extend, ballpark fair price), (2) franchise tag recommendation if applicable, (3) cut consequence explanation for 1–2 key contracts. Use only the data above.`

  return { system, user }
}

function buildTradeCapPrompt(
  ctx: SalaryCapAIDeterministicContext
): { system: string; user: string } {
  const system = `You are AllFantasy's Salary Cap League trade and strategy advisor. Your role is EXPLANATION and FRAMING only.

RULES:
- Trade cap impact and legality are DETERMINISTIC (league engine). You never compute or override them.
- Explain trade cap impact (incoming/outgoing salary), contender vs rebuilder framing, replacement-value context. Do not invent cap numbers.
- Keep response under 300 words.`

  const user = `${contextSummary(ctx)}

Provide: (1) how to think about trade cap impact (both sides), (2) contender vs rebuilder framing for this roster, (3) replacement-value analysis (when to pay up vs stay flexible). Use only the data above.`

  return { system, user }
}

function buildBestballPrompt(
  ctx: SalaryCapAIDeterministicContext
): { system: string; user: string } {
  const sport = sportLabel(ctx.sport)
  const system = `You are AllFantasy's Salary Cap Best Ball advisor. Your role is EXPLANATION only.

RULES:
- Best ball lineup optimization is DETERMINISTIC (league engine). You never compute lineups or scores.
- Explain: roster construction strengths/weaknesses, spike-week vs floor analysis, position fragility, future-year cap risk. Do not invent stats or lineups.
- Keep response under 300 words.`

  const user = `${contextSummary(ctx)}

Provide: (1) roster construction strengths and weaknesses for best ball, (2) spike-week vs floor considerations for ${sport}, (3) position fragility, (4) future cap risk. Use only the data above.`

  return { system, user }
}

function buildOffseasonPlanningPrompt(
  ctx: SalaryCapAIDeterministicContext
): { system: string; user: string } {
  const system = `You are AllFantasy's Salary Cap League long-range planning advisor. Your role is STRATEGY and EXPLANATION only.

RULES:
- Cap projections, lottery order, and contract expiration are DETERMINISTIC. You never compute or override them.
- Advise on: 2–5 year planning, title window analysis, rookie contract planning, lottery strategy (if enabled), whether to conserve cap or push.
- Do not invent cap or lottery numbers. Use only the provided context.
- Keep response under 350 words.`

  const user = `${contextSummary(ctx)}

${ctx.config.weightedLotteryEnabled && ctx.lottery ? 'Lottery is enabled; result stored for this year.' : ''}

Provide: (1) 2–5 year cap and roster planning, (2) title window analysis, (3) rookie contract planning, (4) lottery strategy if relevant, (5) conserve cap vs push. Use only the data above.`

  return { system, user }
}

function buildOrphanTakeoverPrompt(
  ctx: SalaryCapAIDeterministicContext
): { system: string; user: string } {
  const system = `You are AllFantasy's Salary Cap League orphan team advisor. Your role is RECOMMENDATION and EXPLANATION only.

RULES:
- All cap numbers and contract status are DETERMINISTIC. You never compute or change them.
- Provide: takeover plan for bad contracts, cap-cleanup plan, staged rebuild recommendation. Suitable for AI or new manager taking over a messy cap situation.
- Do not invent contract or cap figures. Use only the provided context.
- Keep response under 300 words.`

  const user = `${contextSummary(ctx)}

Provide: (1) takeover plan (priorities for bad contracts), (2) cap-cleanup steps, (3) staged rebuild recommendation. Use only the data above.`

  return { system, user }
}

export function buildPromptForType(
  type: SalaryCapAIContextType,
  ctx: SalaryCapAIDeterministicContext
): { system: string; user: string } {
  switch (type) {
    case 'startup_auction':
      return buildStartupAuctionPrompt(ctx)
    case 'cap_health':
      return buildCapHealthPrompt(ctx)
    case 'extension_tag':
      return buildExtensionTagPrompt(ctx)
    case 'trade_cap':
      return buildTradeCapPrompt(ctx)
    case 'bestball':
      return buildBestballPrompt(ctx)
    case 'offseason_planning':
      return buildOffseasonPlanningPrompt(ctx)
    case 'orphan_takeover':
      return buildOrphanTakeoverPrompt(ctx)
    default:
      return buildCapHealthPrompt(ctx)
  }
}
