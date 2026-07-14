import { prisma } from '@/lib/prisma'
import { buildRedraftWarRoomContext } from '@/lib/redraft-war-room/redraftWarRoomContext'
import { evaluateTeamNeeds } from '@/lib/redraft-war-room/redraftTeamNeedsEngine'
import { detectCollusion } from '@/lib/redraft/ai/tradeAnalyzer'

export type InactiveAlert = {
  rosterId: string
  teamName: string | null
  severity: 'low' | 'medium' | 'high'
  reason: string
  reasons: string[]
  recommendedActions: string[]
  lastActivityAt: string | null
}

export type RuleRec = {
  category: 'engagement' | 'integrity' | 'waivers' | 'data'
  severity: 'low' | 'medium' | 'high'
  suggestion: string
  rationale: string
  supportingSignals: string[]
}

export type ModerationResult = {
  allow: boolean
  reason?: string
  severity?: 1 | 2 | 3
  action: 'allow' | 'warn' | 'block'
  flags: string[]
}

type ActivityRow = {
  rosterId: string
  at: Date
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function daysSince(date: Date | null): number | null {
  if (!date) return null
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
}

function maxDate(...dates: Array<Date | null | undefined>): Date | null {
  return dates.reduce<Date | null>((latest, current) => {
    if (!current) return latest
    if (!latest || current.getTime() > latest.getTime()) return current
    return latest
  }, null)
}

function moderateFlagSet(message: string): ModerationResult {
  const normalized = message.trim().toLowerCase()
  if (!normalized) {
    return {
      allow: false,
      action: 'warn',
      severity: 1,
      flags: ['empty_message'],
      reason: 'Message is empty.',
    }
  }

  const collusionPatterns = [
    /\bsplit (the )?(pot|winnings|money)\b/i,
    /\bbench (your|ur) starters\b/i,
    /\bthrow (the )?(matchup|game)\b/i,
    /\bdo(n'?t| not) set your lineup\b/i,
    /\bi'?ll pay you\b/i,
  ]
  if (collusionPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      allow: false,
      action: 'block',
      severity: 3,
      flags: ['possible_collusion_language'],
      reason: 'Message contains possible collusion or matchup-manipulation language.',
    }
  }

  const abusePatterns = [/\bkill yourself\b/i, /\byou suck\b/i, /\bidiot\b/i, /\btrash commissioner\b/i]
  if (abusePatterns.some((pattern) => pattern.test(normalized))) {
    return {
      allow: false,
      action: 'block',
      severity: 3,
      flags: ['abusive_language'],
      reason: 'Message contains abusive language that should be blocked.',
    }
  }

  const profanityPatterns = [/\bdamn\b/i, /\bhell\b/i, /\bshit\b/i]
  if (profanityPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      allow: true,
      action: 'warn',
      severity: 1,
      flags: ['profanity'],
      reason: 'Message is probably fine for league chat, but contains profanity.',
    }
  }

  return {
    allow: true,
    action: 'allow',
    severity: 1,
    flags: [],
    reason: 'No moderation issues detected.',
  }
}

async function loadCommissionerContext(seasonId: string, userId: string) {
  const season = await prisma.redraftSeason.findFirst({
    where: { id: seasonId },
    select: { id: true, leagueId: true, currentWeek: true, playoffStartWeek: true },
  })
  if (!season) return null

  const contextResult = await buildRedraftWarRoomContext({
    leagueId: season.leagueId,
    userId,
    seasonId: season.id,
  })
  if (!contextResult.ok) return null

  return {
    season,
    context: contextResult.context,
  }
}

async function loadRecentActivity(seasonId: string, rosterIds: string[]): Promise<Map<string, Date>> {
  const cutoff = new Date(Date.now() - 28 * 86400000)
  const [waiverClaims, transactions, proposals] = await Promise.all([
    prisma.redraftWaiverClaim.findMany({
      where: {
        seasonId,
        rosterId: { in: rosterIds },
        submittedAt: { gte: cutoff },
      },
      select: {
        rosterId: true,
        submittedAt: true,
      },
      orderBy: [{ submittedAt: 'desc' }],
      take: 200,
    }),
    prisma.redraftLeagueTransaction.findMany({
      where: {
        seasonId,
        rosterId: { in: rosterIds },
        createdAt: { gte: cutoff },
      },
      select: {
        rosterId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    }),
    prisma.redraftTradeProposal.findMany({
      where: {
        seasonId,
        OR: [{ proposerRosterId: { in: rosterIds } }, { receiverRosterId: { in: rosterIds } }],
        updatedAt: { gte: cutoff },
      },
      select: {
        proposerRosterId: true,
        receiverRosterId: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    }),
  ])

  const activity = new Map<string, Date>()
  const updateMap = ({ rosterId, at }: ActivityRow) => {
    const current = activity.get(rosterId)
    if (!current || at.getTime() > current.getTime()) {
      activity.set(rosterId, at)
    }
  }

  waiverClaims.forEach((claim) => updateMap({ rosterId: claim.rosterId, at: claim.submittedAt }))
  transactions.forEach((tx) => updateMap({ rosterId: tx.rosterId, at: tx.createdAt }))
  proposals.forEach((proposal) => {
    updateMap({ rosterId: proposal.proposerRosterId, at: proposal.updatedAt })
    updateMap({ rosterId: proposal.receiverRosterId, at: proposal.updatedAt })
  })

  return activity
}

export async function detectInactiveManagers(
  seasonId: string,
  userId: string,
): Promise<InactiveAlert[]> {
  const loaded = await loadCommissionerContext(seasonId, userId)
  if (!loaded) return []

  const { context } = loaded
  const rosterIds = context.teams.map((team) => team.rosterId)
  const recentActivity = await loadRecentActivity(seasonId, rosterIds)

  return context.teams
    .map((team) => {
      const needs = evaluateTeamNeeds(context, team.rosterId)
      const criticalNeeds = needs.needs.filter((need) => need.severity === 'critical')
      const lastActivity = recentActivity.get(team.rosterId) ?? null
      const inactiveDays = daysSince(lastActivity)
      const starterCount = team.players.filter((player) => player.isStarterSlot).length
      const starterShortfall = Math.max(0, context.roster.totalStarterSlots - starterCount)

      const reasons = uniqueStrings([
        inactiveDays == null
          ? 'No recent waiver, trade, or transaction activity in the last 28 days.'
          : inactiveDays >= 21
            ? `No meaningful roster activity in ${inactiveDays} days.`
            : null,
        starterShortfall > 0 ? `${starterShortfall} starting slot(s) appear unfilled.` : null,
        criticalNeeds.length > 0 ? `${criticalNeeds.length} critical lineup need(s) remain unresolved.` : null,
        team.isEliminated && inactiveDays != null && inactiveDays >= 14
          ? 'Team is eliminated and has gone quiet during consolation weeks.'
          : null,
      ])

      if (reasons.length === 0) return null

      const recommendedActions = uniqueStrings([
        starterShortfall > 0 ? `Send a lineup reminder before week ${context.currentWeek} lock.` : null,
        criticalNeeds.length > 0 ? `Highlight ${criticalNeeds[0]?.position} as the first repair priority.` : null,
        inactiveDays != null && inactiveDays >= 21 ? 'Reach out directly or suggest a co-manager if silence continues.' : null,
      ])
      const severity: InactiveAlert['severity'] =
        starterShortfall >= 2 || (inactiveDays != null && inactiveDays >= 28)
          ? 'high'
          : starterShortfall > 0 || (inactiveDays != null && inactiveDays >= 21)
            ? 'medium'
            : 'low'

      return {
        rosterId: team.rosterId,
        teamName: team.teamName,
        severity,
        reason: reasons[0],
        reasons,
        recommendedActions,
        lastActivityAt: lastActivity?.toISOString() ?? null,
      }
    })
    .filter((alert): alert is InactiveAlert => Boolean(alert))
    .sort((left, right) => {
      const rank = { high: 3, medium: 2, low: 1 }
      return rank[right.severity] - rank[left.severity]
    })
}

export async function generateRuleRecommendations(
  leagueId: string,
  seasonId: string,
  userId: string,
): Promise<RuleRec[]> {
  const loaded = await loadCommissionerContext(seasonId, userId)
  if (!loaded || loaded.season.leagueId !== leagueId) return []

  const { context } = loaded
  const [inactiveAlerts, collusionAlerts, integritySettings, openFlags] = await Promise.all([
    detectInactiveManagers(seasonId, userId),
    detectCollusion(leagueId),
    prisma.leagueIntegritySettings.findUnique({
      where: { leagueId },
      select: {
        collusionMonitoringEnabled: true,
        collusionSensitivity: true,
      },
    }),
    prisma.integrityFlag.count({
      where: {
        leagueId,
        status: 'open',
      },
    }),
  ])

  const recommendations: RuleRec[] = []

  if (context.waivers.type !== 'faab' && context.teams.length >= 10) {
    recommendations.push({
      category: 'waivers',
      severity: 'medium',
      suggestion: 'Consider switching to FAAB before next season for a fairer waiver market.',
      rationale: 'Large leagues tend to create long waiver-priority droughts, while FAAB spreads opportunity more evenly.',
      supportingSignals: [`Current waiver type: ${context.waivers.type}.`, `${context.teams.length} teams in league.`],
    })
  }

  if (inactiveAlerts.length >= Math.max(2, Math.ceil(context.teams.length * 0.25))) {
    recommendations.push({
      category: 'engagement',
      severity: 'high',
      suggestion: 'Add a weekly lineup-reminder or co-manager policy to keep the league competitive.',
      rationale: 'Multiple rosters look inactive enough to affect lineup integrity and league fairness.',
      supportingSignals: [`${inactiveAlerts.length} roster(s) flagged for inactivity.`, `Week ${context.currentWeek} of the season.`],
    })
  }

  if ((integritySettings?.collusionMonitoringEnabled ?? true) === false) {
    recommendations.push({
      category: 'integrity',
      severity: 'high',
      suggestion: 'Re-enable collusion monitoring before more trades process.',
      rationale: 'The league has commissioner AI available, but integrity scanning is turned off.',
      supportingSignals: ['Collusion monitoring disabled in league integrity settings.'],
    })
  } else if (collusionAlerts.length > 0 || openFlags > 0) {
    recommendations.push({
      category: 'integrity',
      severity: 'high',
      suggestion: 'Review open integrity flags before approving more trades.',
      rationale: 'The integrity system is already flagging trade patterns that need human review.',
      supportingSignals: uniqueStrings([
        `${collusionAlerts.length} open collusion alert(s).`,
        `${openFlags} total open integrity flag(s).`,
        integritySettings?.collusionSensitivity
          ? `Sensitivity: ${integritySettings.collusionSensitivity}.`
          : null,
      ]),
    })
  }

  if (context.availability.projections !== 'available' || context.availability.injuries !== 'available') {
    recommendations.push({
      category: 'data',
      severity: 'medium',
      suggestion: 'Hold off on stricter commissioner automation until player projections and injuries are fully fresh.',
      rationale: 'League-level AI recommendations are safer when the underlying redraft data foundation is current.',
      supportingSignals: uniqueStrings([
        context.availability.projections !== 'available' ? 'Projections are not fully available.' : null,
        context.availability.injuries !== 'available' ? 'Injury data is not fully available.' : null,
      ]),
    })
  }

  if (recommendations.length === 0) {
    recommendations.push({
      category: 'engagement',
      severity: 'low',
      suggestion: 'No urgent rules change stands out right now; keep weekly commissioner reminders and monitor trade reviews.',
      rationale: 'Current league settings look stable enough for the present week.',
      supportingSignals: [`Week ${context.currentWeek}.`, `Open integrity flags: ${openFlags}.`],
    })
  }

  return recommendations
}

export async function moderateLeagueChat(
  message: string,
  _leagueId: string,
): Promise<ModerationResult> {
  return moderateFlagSet(message)
}
