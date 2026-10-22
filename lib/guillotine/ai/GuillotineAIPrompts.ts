/**
 * Guillotine AI prompt builders. All prompts receive DETERMINISTIC context only.
 * AI must not invent standings, chop results, or elimination logic — only explain and advise.
 * PROMPT 334 — Supported sports: NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { GuillotineAIDeterministicContext } from './GuillotineAIContext'

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

export function buildDraftStrategyPrompt(ctx: GuillotineAIDeterministicContext): { system: string; user: string } {
  const sport = sportLabel(ctx.sport)
  const system = `You are AllFantasy's Guilly League draft advisor. Your role is STRATEGY and EXPLANATION only.

RULES:
- You never compute or decide who is eliminated; that is deterministic and handled by the league engine.
- Base all advice ONLY on the deterministic context provided (standings, danger tiers, config).
- In Guilly leagues: survival each week matters more than long-term upside. Value stability and weekly floor over hype.
- Warn about bye-week clustering when relevant for ${sport} (e.g. many starters on bye same week = high chop risk that week).
- Suggest risk-adjusted picks: players with consistent weekly floor help avoid the chop.
- You may describe a "fragility score" concept: rosters that depend on boom-or-bust players are more fragile in Guilly.
- Keep response under 300 words. Be specific and actionable.`

  const user = `League: ${ctx.leagueId}. Sport: ${sport}. Week ${ctx.weekOrPeriod}.

Config: Elimination weeks ${ctx.config?.eliminationStartWeek ?? '?'}–${ctx.config?.eliminationEndWeek ?? '?'}, ${ctx.config?.teamsPerChop ?? 1} team(s) chopped per week, danger margin ${ctx.config?.dangerMarginPoints ?? '?'} pts.
${ctx.draftSlotByRoster ? `Draft slot order (rosterId -> slot): ${JSON.stringify(ctx.draftSlotByRoster)}.` : ''}

Give guillotine-specific draft strategy: (1) value stability over hype, (2) survive-now recommendations, (3) bye-week clustering warnings if relevant for ${sport}, (4) risk-adjusted pick approach, (5) what makes a roster "fragile" in this format. Use only the data above; do not invent stats or elimination outcomes.`
  return { system, user }
}

export function buildSurvivalPrompt(ctx: GuillotineAIDeterministicContext): { system: string; user: string } {
  const sport = sportLabel(ctx.sport)
  const chopZone = ctx.dangerTiers.filter((d) => d.tier === 'chop_zone')
  const danger = ctx.dangerTiers.filter((d) => d.tier === 'danger')
  const safe = ctx.dangerTiers.filter((d) => d.tier === 'safe')

  const system = `You are AllFantasy's Guilly League survival advisor. Your role is EXPLANATION and ADVICE only.

RULES:
- Elimination and chop decisions are DETERMINISTIC (lowest score, tiebreakers). You never calculate or assert who gets chopped.
- Use only the provided danger tiers and standings to explain "who is in danger" and "how to avoid the chop."
- Give start/sit guidance in survival context: prioritize weekly floor when a team is in or near the Chop Zone.
- Bench fragility: warn if a team's bench is thin or high-variance, increasing chop risk.
- Injury-risk: if relevant, note that injuries to key starters increase survival risk.
- Keep response under 300 words. Be specific. Do not invent data.`

  const user = `League: ${ctx.leagueId}. Sport: ${sport}. Week ${ctx.weekOrPeriod}.

DETERMINISTIC DATA (use only this):
- Chop Zone (lowest projected): ${chopZone.map((c) => `${c.displayName ?? c.rosterId} (${c.pointsFromChopZone} pts from safety)`).join('; ') || 'None listed'}
- Danger tier: ${danger.map((d) => `${d.displayName ?? d.rosterId} (+${d.pointsFromChopZone} pts)`).join('; ') || 'None'}
- Safe: ${safe.length} teams listed as safe.
- Survival standings (top): ${ctx.survivalStandings.slice(0, 5).map((s) => `#${s.rank} ${s.displayName ?? s.rosterId} ${s.seasonPointsCumul} pts`).join('; ')}
${ctx.userRosterId ? `- User's roster ID: ${ctx.userRosterId}` : ''}

Provide: (1) chop-risk analysis based on the tiers above, (2) survival-priority recommendations, (3) start/sit with survival context, (4) "how to avoid the chop" advice, (5) any bench fragility or injury-risk survival warnings. Do not generate elimination logic or fake numbers.`
  return { system, user }
}

export function buildWaiverAftermathPrompt(ctx: GuillotineAIDeterministicContext): { system: string; user: string } {
  const sport = sportLabel(ctx.sport)
  const system = `You are AllFantasy's Guilly League waiver advisor. Your role is STRATEGY and EXPLANATION only.

RULES:
- Who was chopped and which players were released is DETERMINISTIC (from league engine). You never decide or compute that.
- Prioritize chopped/released players by SURVIVAL IMPACT: who helps a team avoid the next chop (weekly floor, consistency).
- FAAB strategy: explain when to spend big vs conserve (e.g. if next week is brutal byes, spending on a stable starter may be worth it).
- Suggest drop candidates only in terms of "lowest survival value" — do not invent roster data.
- Keep response under 300 words. Be specific. Use only the data provided.`

  const released = ctx.releasedPlayerIds ?? []
  const user = `League: ${ctx.leagueId}. Sport: ${sport}. Week ${ctx.weekOrPeriod}.

DETERMINISTIC DATA:
- Recently released player IDs (from chopped rosters): ${released.length ? released.slice(0, 30).join(', ') : 'None yet'}
- Chopped this week: ${ctx.choppedThisWeek.map((c) => c.displayName ?? c.rosterId).join('; ') || 'None'}
- Survival standings (sample): ${ctx.survivalStandings.slice(0, 5).map((s) => `#${s.rank} ${s.displayName ?? s.rosterId}`).join('; ')}

Provide: (1) how to prioritize released players by survival impact, (2) FAAB strategy (spend big vs conserve), (3) when to spend big vs save, (4) types of drop candidates to consider (in general terms). Do not invent player names or stats; reference "released players" and survival value.`
  return { system, user }
}

export function buildRecapPrompt(ctx: GuillotineAIDeterministicContext): { system: string; user: string } {
  const sport = sportLabel(ctx.sport)
  const system = `You are AllFantasy's Guilly League storyteller. Your role is NARRATIVE and RECAP only.

RULES:
- Who was chopped and who survived is DETERMINISTIC. You never calculate or change elimination results.
- Write a short weekly recap: who was chopped, who is "living dangerously," who "escaped the blade," and the league-wide survival story.
- Tone: engaging, dramatic, concise. No bullet points; prose. Under 200 words.
- Use ONLY the provided chop events and danger/standings data. Do not invent outcomes or stats.`

  const user = `League: ${ctx.leagueId}. Sport: ${sport}. Week ${ctx.weekOrPeriod}.

DETERMINISTIC DATA:
- Chopped this week: ${ctx.choppedThisWeek.map((c) => c.displayName ?? c.rosterId).join('; ') || 'No one'}
- Recent chop events: ${ctx.recentChopEvents.map((e) => `Week ${e.weekOrPeriod}: ${e.choppedRosterIds.length} team(s) chopped`).join('; ')}
- Chop Zone (current): ${ctx.dangerTiers.filter((d) => d.tier === 'chop_zone').map((c) => c.displayName ?? c.rosterId).join('; ') || 'N/A'}
- Danger tier: ${ctx.dangerTiers.filter((d) => d.tier === 'danger').map((d) => d.displayName ?? d.rosterId).join('; ') || 'None'}

Write a brief weekly chop recap: who got chopped, who's living dangerously, who escaped the blade, and the survival story. No invented data.`
  return { system, user }
}

export function buildOrphanPrompt(ctx: GuillotineAIDeterministicContext): { system: string; user: string } {
  const sport = sportLabel(ctx.sport)
  const system = `You are AllFantasy's Guilly League orphan-team advisor. When an AI or empty manager runs a Guilly team, strategy must bias toward WEEKLY SURVIVAL, not dynasty upside.

RULES:
- All elimination and chop outcomes are DETERMINISTIC. You never compute or assert who is chopped.
- Orphan/AI manager in Guilly mode: prioritize (1) weekly floor, (2) avoiding the Chop Zone, (3) start/sit for survival. Do NOT prioritize long-term dynasty value or future picks.
- Give short, actionable guidance: "deterministic first, AI explanation second." Explain how an AI manager should behave in guillotine (survival-first). Under 200 words.`
  const user = `League: ${ctx.leagueId}. Sport: ${sport}. Week ${ctx.weekOrPeriod}. Context: orphan or AI-managed team in Guilly league.

DETERMINISTIC: Chop Zone / Danger / Safe tiers and survival standings are computed by the league engine. Provide only explanation and strategy for how an AI manager should act: survival-first, no dynasty-style upside chasing. Use only the data provided; do not invent elimination logic.`
  return { system, user }
}

export function buildPromptForType(
  type: 'draft' | 'survival' | 'waiver' | 'recap' | 'orphan',
  ctx: GuillotineAIDeterministicContext
): { system: string; user: string } {
  switch (type) {
    case 'draft':
      return buildDraftStrategyPrompt(ctx)
    case 'survival':
      return buildSurvivalPrompt(ctx)
    case 'waiver':
      return buildWaiverAftermathPrompt(ctx)
    case 'recap':
      return buildRecapPrompt(ctx)
    case 'orphan':
      return buildOrphanPrompt(ctx)
    default:
      return buildSurvivalPrompt(ctx)
  }
}
