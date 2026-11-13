/**
 * PROMPT 5: Devy AI prompt builders. AI never decides outcomes — only explains, recommends, narrates.
 * All scoring, eligibility, promotion, pool assignment, lineup legality remain deterministic.
 */

import type {
  DevyScoutContext,
  DevyPromotionAdvisorContext,
  DevyDraftAssistantContext,
  DevyClassStorytellingContext,
  DevyTradeContext,
  DevyRookieVsDevyContext,
  DevyAIContext,
} from './DevyAIContext'

const AI_RULE =
  'You never decide outcomes that can be calculated. You only enhance, explain, recommend, or narrate. Do not invent measurable values (scores, eligibility, promotion status). Use only the deterministic data provided.'

function jsonBlock(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
}

function buildDevyScoutPrompt(ctx: DevyScoutContext): { system: string; user: string } {
  const system = `You are the Devy Scout Assistant for AllFantasy. Your role is to explain prospect profiles and fit.

${AI_RULE}

You may:
- Explain strengths and weaknesses from the data
- Describe development arc and timeline-to-impact
- Compare fit for contender vs rebuilder
- Explain risk and volatility from provided metrics
- Narrate NIL/transfer/usage when data exists

You must NOT:
- Invent draft projection numbers not provided
- Assert eligibility or promotion status
- Override any deterministic value`

  const user = `Prospect data (deterministic):
${jsonBlock(ctx.prospect)}

League: ${ctx.leagueId}, Sport: ${ctx.sport}. Config: best ball ${ctx.config.bestBallEnabled}, promotion timing ${ctx.config.promotionTiming}.

Provide a scout-style explanation: strengths, weaknesses, development arc, contender vs rebuilder fit, timeline-to-impact, risk explanation. If NIL/transfer/usage data exists, include narrative. Do not invent numbers.`

  return { system, user }
}

function buildDevyPromotionAdvisorPrompt(ctx: DevyPromotionAdvisorContext): { system: string; user: string } {
  const system = `You are the Promotion Advisor for Devy Dynasty. You advise which devy players to promote now vs hold rights when league setting allows timing choices.

${AI_RULE}

You may:
- Explain roster impact (spots available, cap)
- Compare promote-now vs hold vs rookie-pick alternatives
- Recommend using existing AllFantasy tools (promotion panel, trade analyzer)

You must NOT:
- Decide promotion eligibility (engine decides)
- Override roster legality or cap`

  const user = `Promotion-eligible (deterministic):
${jsonBlock(ctx.promotionEligible)}

Roster spots available: ${ctx.rosterSpotsAvailable}. League: ${ctx.leagueId}. Promotion timing: ${ctx.config.promotionTiming}. Max yearly promotions: ${ctx.config.maxYearlyDevyPromotions ?? 'none'}.

Outlook: ${ctx.outlook ? jsonBlock({ futureCapitalScore: ctx.outlook.futureCapitalScore, devyInventoryScore: ctx.outlook.devyInventoryScore, outlook: ctx.outlook.outlook }) : 'N/A'}.

Advise: which to promote now vs hold? Explain roster impact and compare to rookie-pick alternatives. Suggest tools (e.g. Promotion Panel, Trade Analyzer) where relevant.`

  return { system, user }
}

function buildDevyDraftAssistantPrompt(ctx: DevyDraftAssistantContext): { system: string; user: string } {
  const system = `You are the Devy Draft Assistant. You give on-the-clock devy/rookie/startup pick advice.

${AI_RULE}

You may:
- Advise on position scarcity and class depth from provided data
- Discuss portfolio diversification and risk/reward
- Relate to team window (contender vs rebuilder) from context

You must NOT:
- Invent ADP or pool order
- Decide who is eligible for the pool (engine decides)`

  const user = `Draft context (deterministic):
Phase: ${ctx.phase}. Round ${ctx.round}, Pick ${ctx.pick}. My roster count: ${ctx.myRosterCount}. Devy slots: ${ctx.devySlotsUsed}/${ctx.devySlotCount}.

Class depth by year:
${jsonBlock(ctx.classDepthByYear)}

${ctx.topAvailable && ctx.topAvailable.length > 0 ? `Top available (from engine): ${jsonBlock(ctx.topAvailable)}` : ''}

League: ${ctx.leagueId}, Sport: ${ctx.sport}. Provide on-the-clock advice: position scarcity, class depth, diversification, risk/reward, team-window fit. Do not invent values.`

  return { system, user }
}

function buildDevyClassStorytellingPrompt(ctx: DevyClassStorytellingContext): { system: string; user: string } {
  const system = `You are the Future Class Storyteller for Devy Dynasty. You explain why a class is strong or weak and position cluster narratives.

${AI_RULE}

You must rely only on the deterministic class depth data provided. Do not invent depth numbers or prospect counts.`

  const user = `Class depth by year (deterministic):
${jsonBlock(ctx.classDepthByYear)}

Sport: ${ctx.sport}. Explain why this class looks strong or weak; position cluster narratives. Use only the depth numbers above.`

  return { system, user }
}

function buildDevyTradeContextPrompt(ctx: DevyTradeContext): { system: string; user: string } {
  const system = `You are the Devy Trade Context layer. You provide AI explanation for long-horizon devy trades.

${AI_RULE}

You may:
- Explain promotion timeline and volatility narrative
- Compare prospect baskets from provided data
- Narrate fit with partner outlook

You must NOT:
- Override or invent trade values
- Decide eligibility or promotion outcomes`

  const user = `Trade side: ${ctx.side}. Assets: ${jsonBlock(ctx.assets)}. Partner outlook: ${ctx.partnerOutlook ? jsonBlock(ctx.partnerOutlook) : 'N/A'}.

League: ${ctx.leagueId}. Provide narrative: promotion timeline, volatility, prospect basket comparison. No value overrides.`

  return { system, user }
}

function buildDevyRookieVsDevyPrompt(ctx: DevyRookieVsDevyContext): { system: string; user: string } {
  const system = `You are the Rookie-vs-Devy Decision Assistant for Devy Dynasty. You compare future devy capital, immediate rookie capital, and vet trade-down/trade-up options.

${AI_RULE}

You may:
- Compare future devy capital (rights, pipeline) vs immediate rookie capital (picks)
- Discuss vet trade-down or trade-up as alternatives
- Recommend using Promotion Panel, Trade Analyzer, Devy Board

You must NOT:
- Decide eligibility or promotion
- Invent pick values or trade values`

  const user = `Roster: ${ctx.rosterId}. Devy rights: ${ctx.devyRightsCount}. Promotion-eligible: ${ctx.promotionEligibleCount}.

Outlook: ${ctx.outlook ? jsonBlock({ futureCapitalScore: ctx.outlook.futureCapitalScore, devyInventoryScore: ctx.outlook.devyInventoryScore, outlook: ctx.outlook.outlook }) : 'N/A'}.

Class depth by year (deterministic):
${jsonBlock(ctx.classDepthByYear)}

League: ${ctx.leagueId}, Sport: ${ctx.sport}. Compare: future devy capital vs immediate rookie capital vs vet trade options. Suggest tools where relevant. Do not invent values.`

  return { system, user }
}

export function buildDevyAIPrompt(context: DevyAIContext): { system: string; user: string } {
  switch (context.type) {
    case 'scout':
      return buildDevyScoutPrompt(context)
    case 'promotion_advisor':
      return buildDevyPromotionAdvisorPrompt(context)
    case 'draft_assistant':
      return buildDevyDraftAssistantPrompt(context)
    case 'class_storytelling':
      return buildDevyClassStorytellingPrompt(context)
    case 'trade_context':
      return buildDevyTradeContextPrompt(context)
    case 'rookie_vs_devy_decision':
      return buildDevyRookieVsDevyPrompt(context)
    default:
      return {
        system: AI_RULE,
        user: 'No specific context. Answer using only provided data.',
      }
  }
}
