/**
 * User OS League-Specific Intelligence Wiring phase — Part 9, strategy
 * domain (contender/retool/rebuild classification).
 *
 * Built as a new, small, provider-neutral classifier rather than reusing
 * `lib/season-strategy.ts`'s `computeSeasonStrategy` — this phase's Part 1
 * inventory found that function fetches Sleeper data internally
 * (Sleeper-coupled), which would break the League Hub's provider-neutral
 * design for ESPN/Yahoo/MFL/Fantrax/native leagues. `lib/dynasty-engine/*`
 * is real but dynasty-only. Neither is safely reusable as-is for this
 * generator's provider-agnostic requirement, so a new, deliberately small,
 * deterministic classifier was written — not a duplicate, since nothing
 * else in the inventory could serve this exact role. Documented explicitly
 * per the "do not duplicate" guardrail's own spirit: reuse when reuse is
 * safe, build small and disclosed when it genuinely isn't.
 */
import type { UserOsContext } from '../userOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../types'

export type StrategyClassification =
  | 'strong_contender'
  | 'contender'
  | 'fringe_contender'
  | 'retool'
  | 'rebuild'
  | 'insufficient_evidence'

export interface StrategyClassificationResult {
  classification: StrategyClassification
  confidence: number
  posture: string
  actionsToTake: string[]
  actionsToAvoid: string[]
  evidence: string[]
}

const MIN_WEEKS_FOR_EVIDENCE = 3

export function classifyStrategy(context: UserOsContext): StrategyClassificationResult | null {
  if (!context.viewerTeam || context.standings.length < 2) return null

  if (context.currentWeek < MIN_WEEKS_FOR_EVIDENCE) {
    return {
      classification: 'insufficient_evidence',
      confidence: 0.3,
      posture: 'Too early in the season to classify — check back after a few more weeks of results.',
      actionsToTake: ['Monitor early performance', 'Avoid overreacting to small samples'],
      actionsToAvoid: ['Making a major rebuild/sell-off decision this early'],
      evidence: [`Only ${context.currentWeek} week(s) of results so far (minimum ${MIN_WEEKS_FOR_EVIDENCE} for a real classification).`],
    }
  }

  const sorted = [...context.standings].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    return b.pointsFor - a.pointsFor
  })
  const rankIndex = sorted.findIndex((t) => t.teamId === context.viewerTeam?.teamId)
  const teamCount = sorted.length
  const percentile = teamCount > 1 ? 1 - rankIndex / (teamCount - 1) : 0.5
  const games = context.viewerTeam.wins + context.viewerTeam.losses + context.viewerTeam.ties
  const winPct = games > 0 ? (context.viewerTeam.wins + context.viewerTeam.ties * 0.5) / games : 0

  const evidence = [
    `Record: ${context.viewerTeam.wins}-${context.viewerTeam.losses}${context.viewerTeam.ties ? `-${context.viewerTeam.ties}` : ''} (${(winPct * 100).toFixed(0)}% win rate).`,
    `League standing: #${rankIndex + 1} of ${teamCount} (${(percentile * 100).toFixed(0)}th percentile).`,
  ]

  let classification: StrategyClassification
  let confidence: number
  if (percentile >= 0.85 && winPct >= 0.6) {
    classification = 'strong_contender'
    confidence = 0.75
  } else if (percentile >= 0.6) {
    classification = 'contender'
    confidence = 0.65
  } else if (percentile >= 0.35) {
    classification = 'fringe_contender'
    confidence = 0.5
  } else {
    // Redraft never gets "rebuild" — only dynasty leagues can carry a real multi-season rebuild framing.
    classification = context.isDynasty ? 'rebuild' : 'retool'
    confidence = 0.55
  }

  const posture: Record<StrategyClassification, string> = {
    strong_contender: context.isDynasty
      ? 'Your championship window is open — prioritize win-now moves.'
      : 'Push for the championship — this is your best roster of the season.',
    contender: context.isDynasty ? 'Contend this year while your window is open.' : 'Push for the playoffs.',
    fringe_contender: context.isDynasty
      ? 'On the contention bubble — retool around your core rather than a full rebuild.'
      : 'Aggressively improve — you are close to a playoff spot but need real upgrades.',
    retool: 'Retool for the remaining season — hold your best assets and look for value, rather than a full sell-off.',
    rebuild: 'Rebuild — prioritize future draft assets and long-term value over marginal current-season wins.',
    insufficient_evidence: 'Too early in the season to classify.',
  }

  const actionsToTake: Record<StrategyClassification, string[]> = {
    strong_contender: ['Consider trading future assets for immediate roster upgrades', 'Prioritize matchup-proof depth'],
    contender: ['Look for buy-low upgrades at positions of weakness', 'Hold your core roster'],
    fringe_contender: ['Target realistic, low-cost upgrades', 'Re-evaluate weekly as your playoff odds shift'],
    retool: ['Explore trades that improve depth without giving up your best assets', 'Prioritize your own draft slot next season if applicable'],
    rebuild: ['Sell aging or expiring-value assets for future draft capital', 'Prioritize your own team\'s long-term asset accumulation'],
    insufficient_evidence: ['Wait for more data before making a strategic pivot'],
  }
  const actionsToAvoid: Record<StrategyClassification, string[]> = {
    strong_contender: ['Do not trade away your best current-season starters for future assets'],
    contender: ['Do not overpay for marginal upgrades'],
    fringe_contender: ['Do not give up too much value chasing a long-shot playoff push'],
    retool: ['Do not fully rebuild — you are not far enough behind for a full sell-off'],
    rebuild: ['Do not hold marginal veteran assets that will lose value'],
    insufficient_evidence: ['Do not make a major roster-strategy decision this early'],
  }

  return {
    classification,
    confidence,
    posture: posture[classification],
    actionsToTake: actionsToTake[classification],
    actionsToAvoid: actionsToAvoid[classification],
    evidence,
  }
}

export function generateStrategyRecommendations(context: UserOsContext, generatedAt: string): LeagueRecommendation[] {
  if (context.unavailableDomains.includes('strategy') || !context.teamId) return []

  const result = classifyStrategy(context)
  if (!result) return []

  const priority = result.classification === 'insufficient_evidence' ? 'low' : 'medium'
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []

  return [
    buildRecommendation({
      leagueId: context.canonicalLeagueId,
      teamId: context.teamId,
      rosterId: context.rosterId ?? undefined,
      domain: 'strategy',
      type: `classification_${result.classification}`,
      key: 'season-strategy',
      priority,
      title: result.posture,
      summary: result.posture,
      rationale: [...result.evidence, ...result.actionsToTake],
      evidence: result.evidence.map((detail, i) => ({ label: `Evidence ${i + 1}`, detail, source: 'LeagueTeam' })),
      confidence: result.confidence,
      sourceFreshness: context.syncFreshness,
      executionCapability: 'recommendation_only',
      generatedAt,
    }),
  ]
}
