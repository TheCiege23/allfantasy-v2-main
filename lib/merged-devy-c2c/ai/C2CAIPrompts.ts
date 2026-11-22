/**
 * PROMPT 5: C2C AI prompt builders. AI never decides outcomes — only explains, recommends, narrates.
 * All eligibility, scoring, standings, promotions, lineup legality remain deterministic.
 */

import type {
  C2CPipelineAdvisorContext,
  C2CCollegeVsRookieContext,
  C2CStartupDraftAssistantContext,
  C2CPromotionAdvisorContext,
  C2CHybridStrategyContext,
  C2CTradeContext,
  C2CAIContext,
} from './C2CAIContext'

const AI_RULE =
  'You never decide outcomes that can be calculated. You only enhance, explain, recommend, compare, or narrate. Do not invent measurable values (scores, eligibility, promotion status, standings). Use only the deterministic data provided.'

function jsonBlock(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
}

function buildC2CPipelineAdvisorPrompt(ctx: C2CPipelineAdvisorContext): { system: string; user: string } {
  const system = `You are the Pipeline Advisor for College-to-Canton (C2C) leagues. You explain whether a team's college-to-pro pipeline is healthy.

${AI_RULE}

You may:
- Explain short-, mid-, and long-term asset flow from the portfolio data
- Identify bottlenecks by position and over-concentration in one class year or position
- Highlight risks from concentration metrics (maxPositionShare, maxYearShare)

You must NOT:
- Invent pipeline scores or override deterministic data
- Decide eligibility or promotion`

  const user = `Pipeline data (deterministic):
Portfolio: ${jsonBlock(ctx.portfolio)}
Concentration: ${jsonBlock(ctx.concentration)}

League: ${ctx.leagueId}, Sport: ${ctx.sport}. Standings model: ${ctx.config.standingsModel}.

Explain whether this team's college-to-pro pipeline is healthy. Address short/mid/long-term flow, position bottlenecks, and over-concentration. Do not invent values.`

  return { system, user }
}

function buildC2CCollegeVsRookiePrompt(ctx: C2CCollegeVsRookieContext): { system: string; user: string } {
  const system = `You are the College vs Rookie Decision Assistant for C2C. You compare incoming pro rookies, current college assets, future college/rookie picks, and explain timeline-to-impact and risk.

${AI_RULE}

You may:
- Compare college production now vs pro upside later
- Explain timeline-to-impact and risk from provided data
- Recommend using Promotion Panel, Trade Analyzer, Draft Board

You must NOT:
- Create values that override deterministic scores
- Decide promotion or pool assignment`

  const user = `Roster: ${ctx.rosterId}. College rights: ${ctx.collegeRightsCount}. Promotion-eligible: ${ctx.promotionEligibleCount}.
Future rookie picks: ${ctx.futurePicksRookie}. Future college picks: ${ctx.futurePicksCollege}.

Outlook: ${ctx.outlook ? jsonBlock(ctx.outlook) : 'N/A'}.

Class depth by year: ${jsonBlock(ctx.classDepthByYear)}

League: ${ctx.leagueId}, Sport: ${ctx.sport}. Compare: incoming rookies vs college assets vs future picks. Explain timeline and risk. Suggest tools where relevant. Do not invent values.`

  return { system, user }
}

function buildC2CStartupDraftAssistantPrompt(ctx: C2CStartupDraftAssistantContext): { system: string; user: string } {
  const system = `You are the C2C Startup Draft Assistant. You support merged or split startup formats and explain whether to prioritize pro production or college upside.

${AI_RULE}

You may:
- Adjust advice by contender/rebuilder/balanced direction
- Warn against over-investing in ultra-early prospects when deterministic risk is high
- Explain pro vs college upside from class depth

You must NOT:
- Invent ADP or pool order
- Decide who is eligible for a pool (engine decides)`

  const user = `Draft phase: ${ctx.phase}. Round ${ctx.round}, Pick ${ctx.pick}. Direction: ${ctx.direction}.
My pro count: ${ctx.myProCount}. My college count: ${ctx.myCollegeCount}.

Class depth by year: ${jsonBlock(ctx.classDepthByYear)}

League: ${ctx.leagueId}, Sport: ${ctx.sport}. Startup format: ${ctx.config.startupFormat}.
Provide on-the-clock advice: pro vs college upside, contender/rebuilder fit, risk of over-investing in very early prospects. Do not invent values.`

  return { system, user }
}

function buildC2CPromotionAdvisorPrompt(ctx: C2CPromotionAdvisorContext): { system: string; user: string } {
  const system = `You are the Promotion Advisor for C2C. You advise whom to promote now vs later when timing is configurable, and explain standings impact on college and pro side.

${AI_RULE}

You may:
- Explain standings impact on both college and pro side from provided data
- Compare promotion choice vs rookie-draft opportunity cost
- Recommend using Promotion Panel and Trade Analyzer

You must NOT:
- Decide promotion eligibility (engine decides)
- Override roster legality or cap`

  const user = `Promotion-eligible (deterministic): ${jsonBlock(ctx.promotionEligible)}

Roster spots available: ${ctx.rosterSpotsAvailable}. Standings impact: ${ctx.standingsImpact ? jsonBlock(ctx.standingsImpact) : 'N/A'}.

League: ${ctx.leagueId}. Promotion timing: ${ctx.config.promotionTiming}. Max promotions per year: ${ctx.config.maxPromotionsPerYear ?? 'none'}.

Advise: promote now vs later? Explain standings impact (college and pro) and rookie-draft opportunity cost. Suggest tools where relevant. Do not decide outcomes.`

  return { system, user }
}

function buildC2CHybridStrategyPrompt(ctx: C2CHybridStrategyContext): { system: string; user: string } {
  const system = `You are the Hybrid Championship Strategy Assistant for C2C. When hybrid mode is enabled, you explain how college and pro scoring mix affects roster construction.

${AI_RULE}

You may:
- Explain whether the team is underbuilt on the college side or pro side from deterministic weighting
- Use proWeight/collegeWeight from league settings only
- Recommend balancing or leaning based on underbuiltSide

You must NOT:
- Invent hybrid scores or override standings
- Decide lineup or eligibility`

  const user = `Roster: ${ctx.rosterId}. Pro points: ${ctx.proPoints}. College points: ${ctx.collegePoints}. Hybrid score: ${ctx.hybridScore}.
Weights: pro ${ctx.proWeight}%, college ${ctx.collegeWeight}%. Underbuilt side (deterministic): ${ctx.underbuiltSide}.

League ranks (sample): ${jsonBlock(ctx.leagueRanks.slice(0, 5))}

League: ${ctx.leagueId}, Sport: ${ctx.sport}. Explain how college/pro mix affects this roster; whether they are underbuilt on college or pro; use only the weights and data above. Do not invent values.`

  return { system, user }
}

function buildC2CTradeContextPrompt(ctx: C2CTradeContext): { system: string; user: string } {
  const system = `You are the C2C Trade Context layer. You explain long-horizon trades involving college players, rookie picks, and future classes.

${AI_RULE}

You may:
- Compare college production now vs pro upside later
- Explain class-strength asymmetry and pipeline timing from context
- Narrate fit with partner outlook

You must NOT:
- Override or invent trade values
- Decide eligibility or promotion outcomes`

  const user = `Trade side: ${ctx.side}. Assets: ${jsonBlock(ctx.assets)}. Partner outlook: ${ctx.partnerOutlook ? jsonBlock(ctx.partnerOutlook) : 'N/A'}.

League: ${ctx.leagueId}, Sport: ${ctx.sport}. Provide narrative: college vs pro upside, class-strength asymmetry, pipeline timing. No value overrides.`

  return { system, user }
}

export function buildC2CAIPrompt(context: C2CAIContext): { system: string; user: string } {
  switch (context.type) {
    case 'pipeline_advisor':
      return buildC2CPipelineAdvisorPrompt(context)
    case 'college_vs_rookie_decision':
      return buildC2CCollegeVsRookiePrompt(context)
    case 'startup_draft_assistant':
      return buildC2CStartupDraftAssistantPrompt(context)
    case 'promotion_advisor':
      return buildC2CPromotionAdvisorPrompt(context)
    case 'hybrid_strategy':
      return buildC2CHybridStrategyPrompt(context)
    case 'trade_context':
      return buildC2CTradeContextPrompt(context)
    default:
      return {
        system: AI_RULE,
        user: 'No specific context. Answer using only provided data.',
      }
  }
}
