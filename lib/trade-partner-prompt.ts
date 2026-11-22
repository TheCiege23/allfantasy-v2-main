import { z } from 'zod';
import { getUniversalAIContext } from '@/lib/ai-player-context';

export const TRADE_PARTNER_SYSTEM_PROMPT = `You are the AllFantasy Trade Partner AI.

${getUniversalAIContext()}

Rules:
- Use ONLY the provided league and team data.
- Do NOT evaluate a specific trade.
- Your goal is to find BETTER trade matches.
- RESPECT the tier system when suggesting trade targets
- Do NOT suggest acquiring Tier 0 assets without proper compensation
- Do NOT treat IDP players as premium offensive value
- Do NOT suggest trades that would never be accepted in real leagues

Objectives:
1) Scan all teams in the league.
2) Identify which teams are the best trade partners based on:
   - Complementary roster needs
   - Competitive windows (contender vs builder)
   - Archetype compatibility
   - REALISTIC trade value (using tier system)
3) Suggest what type of assets would make sense in a deal.

Bias:
- Favor realistic, mutually beneficial trades.
- Do NOT suggest lopsided or exploitative trades.
- Apply the market plausibility check before suggesting any trade.

JSON only.`;

const LeagueFormatSchema = z.enum(['dynasty', 'keeper', 'redraft']);

const TeamRosterSchema = z.object({
  team_id: z.string(),
  team_name: z.string().optional(),
  archetype: z.string().optional(),
  record: z.string().optional(),
  roster_strengths: z.array(z.string()).optional(),
  roster_weaknesses: z.array(z.string()).optional(),
  key_players: z.array(z.string()).optional(),
  competitive_window: z.string().optional(),
});

const LeagueDataSchema = z.object({
  league_id: z.string().optional(),
  format: LeagueFormatSchema,
  scoring: z.string().optional(),
  standings_summary: z.string().optional(),
});

const TargetTeamSchema = z.object({
  team_id: z.string(),
  team_name: z.string().optional(),
  archetype: z.string().optional(),
  roster_strengths: z.array(z.string()),
  roster_weaknesses: z.array(z.string()),
  key_players: z.array(z.string()).optional(),
  competitive_window: z.string().optional(),
});

export const TradePartnerRequestSchema = z.object({
  league: LeagueDataSchema,
  target_team: TargetTeamSchema,
  other_teams: z.array(TeamRosterSchema),
});

type TradePartnerRequest = z.infer<typeof TradePartnerRequestSchema>;

const TradePartnerMatchSchema = z.object({
  partner_team_id: z.string(),
  partner_archetype: z.string(),
  why_it_works: z.string(),
  ideal_targets: z.array(z.string()),
  assets_to_offer: z.array(z.string()),
});

const AvoidTeamSchema = z.object({
  team_id: z.string(),
  reason: z.string(),
});

export const TradePartnerResponseSchema = z.object({
  team_id: z.string(),
  top_trade_partners: z.array(TradePartnerMatchSchema),
  avoid_teams: z.array(AvoidTeamSchema),
});

export function buildTradePartnerUserPrompt(request: TradePartnerRequest): string {
  const { league, target_team, other_teams } = request;

  return `Find the best trade partners for this team.

OUTPUT FORMAT:
{
  "team_id": string,
  "top_trade_partners": [
    {
      "partner_team_id": string,
      "partner_archetype": string,
      "why_it_works": string,
      "ideal_targets": string[],
      "assets_to_offer": string[]
    }
  ],
  "avoid_teams": [
    {
      "team_id": string,
      "reason": string
    }
  ]
}

DATA:

League:
- format: ${league.format}
- scoring: ${league.scoring || 'Standard'}
- standings_summary: ${league.standings_summary || 'Not provided'}

Target team:
- team_id: ${target_team.team_id}
- team_name: ${target_team.team_name || target_team.team_id}
- archetype: ${target_team.archetype || 'Unknown'}
- roster_strengths: ${JSON.stringify(target_team.roster_strengths)}
- roster_weaknesses: ${JSON.stringify(target_team.roster_weaknesses)}
- key_players: ${JSON.stringify(target_team.key_players || [])}
- competitive_window: ${target_team.competitive_window || 'Unknown'}

Other teams:
${JSON.stringify(other_teams, null, 2)}

Notes:
- Return 3–5 partners if possible.
- Avoid repeating the same reason.`;
}
