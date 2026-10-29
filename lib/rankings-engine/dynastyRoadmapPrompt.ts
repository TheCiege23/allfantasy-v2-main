/**
 * Prompt for `/api/rankings/dynasty-roadmap` (pure, no I/O).
 *
 * The route used to hard-code "dynasty fantasy football strategist" and a Superflex/1QB format line
 * for every league, so an NBA/MLB/NHL dynasty roadmap was written as a football plan with QB
 * valuation advice. The sport now comes from the league (`LeagueRankingsV2Output.sport`) and the
 * prompt names it; QB/Superflex language appears only for football. With sport NFL or unset the
 * text is exactly the original.
 */

export interface DynastyRoadmapPromptInput {
  sport?: string | null
  leagueType: string
  isSF: boolean
  goal: string
  leagueName?: string
  avgAge: number
  totalValue: number
  agingAssets: number
  agingPct: number
  youngCore: number
  youngPct: number
  posStrengthStr: string
  weakPosStr: string
  topAssetsStr: string
  totalPlayers: number
}

const SPORT_LABEL: Record<string, string> = {
  NBA: 'basketball',
  MLB: 'baseball',
  NHL: 'hockey',
  NCAAB: 'college basketball',
  NCAAF: 'college football',
  SOCCER: 'soccer',
}

/** Upper-cased sport, defaulting to NFL for a missing/blank value. */
export function normalizeRoadmapSport(sport: string | null | undefined): string {
  const s = String(sport ?? '').trim().toUpperCase()
  return s || 'NFL'
}

/** Example target positions shown in the JSON schema, so the model is not primed with QB/RB. */
function examplePositions(sport: string): string {
  if (sport === 'NBA' || sport === 'NCAAB') return '["PG", "C"]'
  if (sport === 'MLB') return '["SP", "SS"]'
  if (sport === 'NHL') return '["C", "D"]'
  return '["QB", "RB"]'
}

export function buildDynastyRoadmapPrompt(input: DynastyRoadmapPromptInput): string {
  const sport = normalizeRoadmapSport(input.sport)
  const football = sport === 'NFL' || sport === 'NCAAF'
  const sportLabel = sport === 'NFL' ? 'football' : (SPORT_LABEL[sport] ?? sport)
  const formatSuffix = football ? (input.isSF ? ' Superflex' : ' 1QB') : ` (${sport})`
  const formatRule = football
    ? `6. Consider the ${input.isSF ? 'Superflex' : '1QB'} format in QB valuation.`
    : `6. This league plays ${sport}: use only ${sport} positions and ${sportLabel} aging curves.`

  return `You are a dynasty fantasy ${sportLabel} strategist. Generate a 3-5 year dynasty roadmap based strictly on the computed roster data below. Be motivational but honest.

ROSTER DATA:
- League: ${input.leagueType}${formatSuffix}${input.leagueName ? ` (${input.leagueName})` : ''}
- Goal: ${input.goal}
- Average Roster Age: ${input.avgAge.toFixed(1)}
- Total Roster Value: ${input.totalValue.toLocaleString()}
- Aging Assets (29+): ${input.agingAssets} players (${input.agingPct}%)
- Young Core (24-): ${input.youngCore} players (${input.youngPct}%)
- Position Strengths: ${input.posStrengthStr}
- Weak Positions: ${input.weakPosStr || 'None identified'}
- Top Assets: ${input.topAssetsStr}
- Total Roster Size: ${input.totalPlayers}

RULES:
1. Every recommendation MUST reference specific roster data above (age distribution, position strengths, weak positions).
2. Do NOT invent player names or stats not provided.
3. Each year plan should have 2-4 concrete priorities.
4. Be motivational - frame challenges as opportunities.
5. If the roster is already strong, acknowledge it and suggest maintenance strategies.
${formatRule}
7. Factor in the user's stated goal of "${input.goal}".

Return a JSON object with this exact structure:
{
  "horizon": "3-Year Plan" or "5-Year Plan",
  "currentPhase": one of "Contending" | "Retooling" | "Rebuilding" | "Emerging",
  "overallStrategy": "1-2 sentence summary",
  "yearPlans": [
    {
      "year": 1,
      "label": "Year 1: [Theme]",
      "priorities": ["priority 1", "priority 2"],
      "targetPositions": ${examplePositions(sport)},
      "keyMoves": ["Specific actionable move 1", "Specific actionable move 2"]
    }
  ],
  "riskFactors": ["risk 1", "risk 2"],
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`
}
