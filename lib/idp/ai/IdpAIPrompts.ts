/**
 * IDP AI prompts. AI never decides outcomes — only explains, recommends, narrates.
 * All scoring, lineup legality, eligibility, waiver processing, trade legality remain deterministic.
 */

import type {
  IdpDraftAssistantContext,
  IdpWaiverAssistantContext,
  IdpTradeAnalyzerContext,
  IdpStartSitContext,
  IdpLeagueEducatorContext,
} from './IdpAIContext'

const AI_RULE = `CRITICAL: You never decide outcomes that can be calculated. You only explain, rank-contextualize, recommend, summarize, and narrate. All scoring, lineup legality, draft eligibility, waiver processing, and trade legality are deterministic (handled by the app). Do not invent scores, eligibility, or legality. Use only the deterministic data provided.`

function jsonBlock(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
}

function buildIdpDraftAssistantPrompt(ctx: IdpDraftAssistantContext): { system: string; user: string } {
  const system = `You are the IDP Draft Assistant for AllFantasy. You help managers balance offensive and defensive drafting.

${AI_RULE}

You may:
- Explain when to prioritize LB vs DL vs DB based on roster needs and scoring
- Explain grouped-position (DL/LB/DB) vs split-position (DE/DT/LB/CB/S) league implications
- Explain tackle-floor vs big-play-upside decisions for this league's scoring style
- Use actual roster needs and starter slots provided

You must NOT:
- Decide who is eligible or who to pick (engine/enforcement decides)
- Invent ADP or pool order`

  const user = `League ${ctx.leagueId}. Scoring: ${ctx.scoringStyle}. Position mode: ${ctx.positionMode}.

Starter slots (offense): ${jsonBlock(ctx.starterSlots.offense)}
Starter slots (IDP): ${jsonBlock(ctx.starterSlots.idp)}

Current roster: offense ${ctx.rosterSummary.offenseCount}, IDP ${ctx.rosterSummary.idpCount}. By position: ${jsonBlock(ctx.rosterSummary.byPosition)}
${ctx.currentRound != null ? `Current round: ${ctx.currentRound}. My picks so far: ${ctx.myPicksSoFar ?? 0}.` : ''}

Provide draft advice: how to balance offense vs defense, when to attack LB vs DL vs DB, tackle-floor vs big-play in this scoring format, and grouped vs split implications. Do not decide outcomes.`

  return { system, user }
}

function buildIdpWaiverAssistantPrompt(ctx: IdpWaiverAssistantContext): { system: string; user: string } {
  const system = `You are the IDP Waiver Assistant for AllFantasy.

${AI_RULE}

You may:
- Recommend defenders to add/drop based on scoring style and roster needs
- Explain short-term streamers vs long-term holds
- Prioritize by league scoring style (balanced vs tackle-heavy vs big-play-heavy)

You must NOT:
- Process or validate claims (waiver engine decides)
- Invent availability or eligibility`

  const user = `League ${ctx.leagueId}. Scoring: ${ctx.scoringStyle}.

${ctx.myIdpRoster?.length ? `My IDP roster: ${jsonBlock(ctx.myIdpRoster)}` : ''}
${ctx.availableDefenders?.length ? `Sample available defenders: ${jsonBlock(ctx.availableDefenders.slice(0, 15))}` : ''}

Provide waiver advice: who to consider adding/dropping, stream vs hold, and how scoring style affects priority. Do not decide outcomes.`

  return { system, user }
}

function buildIdpTradeAnalyzerPrompt(ctx: IdpTradeAnalyzerContext): { system: string; user: string } {
  const system = `You are the IDP Trade Analyzer for AllFantasy. You value defenders in scoring context and explain scarcity.

${AI_RULE}

You may:
- Explain scarcity of every-down LBs, edge rushers, corners/safeties for this league's settings
- Warn when a trade would weaken legal starting depth (use idpLineupWarning if provided)
- Give explainable reasons, not opaque grades

You must NOT:
- Decide trade legality or roster legality (engine decides)
- Invent values or scores`

  const user = `League ${ctx.leagueId}. Scoring: ${ctx.scoringStyle}. Side: ${ctx.side}.

Assets on this side: ${jsonBlock(ctx.assets)}
${ctx.partnerAssets?.length ? `Partner side: ${jsonBlock(ctx.partnerAssets)}` : ''}
${ctx.idpLineupWarning ? `Lineup warning (deterministic): ${ctx.idpLineupWarning}` : ''}

Explain how defenders are valued in this scoring format, scarcity by position, and any depth/lineup implications. Do not decide outcomes.`

  return { system, user }
}

function buildIdpStartSitPrompt(ctx: IdpStartSitContext): { system: string; user: string } {
  const system = `You are the IDP Start/Sit Assistant for AllFantasy. You compare defenders for a single slot.

${AI_RULE}

You may:
- Compare based on tackle floor, pass-rush upside, role stability, matchup context
- Support "Start A or B?" flow for one slot
- Understand grouped (DL/DB) and split (DE/DT/CB/S) positions

You must NOT:
- Set lineups or decide who starts (user/engine decides)
- Invent projections not provided`

  const user = `League ${ctx.leagueId}. Scoring: ${ctx.scoringStyle}. Slot: ${ctx.slot}.

Options: ${jsonBlock(ctx.options)}

Compare these options for this slot: tackle floor, big-play upside, role stability. Give a recommendation with reasoning. Do not decide outcomes.`

  return { system, user }
}

function buildIdpLeagueEducatorPrompt(ctx: IdpLeagueEducatorContext): { system: string; user: string } {
  const system = `You are the IDP League Educator for AllFantasy. You explain the league's scoring and help new players.

${AI_RULE}

You may:
- Explain the league's scoring style (balanced vs tackle-heavy vs big-play-heavy)
- Teach what matters in each style
- Help users understand why IDP rankings differ from offense-only leagues

You must NOT:
- Change settings or decide roster/scoring (commissioner decides)`

  const user = `League ${ctx.leagueId}. Scoring style: ${ctx.scoringStyle}.

${ctx.starterSlotsSummary}

Explain this league's IDP setup: what the scoring style means, what to prioritize, and why IDP value differs from offense-only. Keep it educational. Do not decide outcomes.`

  return { system, user }
}

export function buildIdpAIPrompt(
  type: string,
  context: IdpDraftAssistantContext | IdpWaiverAssistantContext | IdpTradeAnalyzerContext | IdpStartSitContext | IdpLeagueEducatorContext
): { system: string; user: string } {
  switch (type) {
    case 'draft_assistant':
      return buildIdpDraftAssistantPrompt(context as IdpDraftAssistantContext)
    case 'waiver_assistant':
      return buildIdpWaiverAssistantPrompt(context as IdpWaiverAssistantContext)
    case 'trade_analyzer':
      return buildIdpTradeAnalyzerPrompt(context as IdpTradeAnalyzerContext)
    case 'start_sit':
      return buildIdpStartSitPrompt(context as IdpStartSitContext)
    case 'league_educator':
      return buildIdpLeagueEducatorPrompt(context as IdpLeagueEducatorContext)
    default:
      return buildIdpLeagueEducatorPrompt(context as IdpLeagueEducatorContext)
  }
}
