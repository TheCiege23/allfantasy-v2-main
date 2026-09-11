import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { UserToneSettings, DEFAULT_TONE_SETTINGS } from '@/lib/ai-personality'

type AIUserProfile = {
  id: string
  userId: string
  sleeperUsername: string | null
  toneMode: string
  detailLevel: string
  riskMode: string
  humorLevel: string
  strategyBias: any
  behaviorMetrics: any
  personalizeEnabled: boolean
  createdAt: Date
  updatedAt: Date
}

type AILeagueContext = {
  id: string
  leagueId: string
  sport: string
  format: string
  sfEnabled: boolean
  tepPremium: boolean
  scoringSettings: any
  rosterSettings: any
  phase: string
  marketBaselines: any
  lastComputedAt: Date
  createdAt: Date
  updatedAt: Date
}

type AITeamStateSnapshot = {
  id: string
  leagueId: string
  teamId: string
  sleeperUsername: string | null
  computedAt: Date
  windowStatus: string
  winNowScore: number
  futureValueScore: number
  qbStabilityScore: number
  rbDependencyScore: number
  pickInventory: any
  notes: string | null
  createdAt: Date
}

type AIMemoryEvent = {
  id: string
  userId: string | null
  leagueId: string | null
  teamId: string | null
  eventType: string
  subject: string
  content: any
  confidence: number
  expiresAt: Date | null
  createdAt: Date
}

export interface AIMemoryContext {
  userProfile: AIUserProfile | null
  leagueContext: AILeagueContext | null
  teamSnapshots: AITeamStateSnapshot[]
  recentEvents: AIMemoryEvent[]
  patterns: string[]
}

export async function getOrCreateUserProfile(userId: string, sleeperUsername?: string): Promise<AIUserProfile> {
  let profile = await prisma.aIUserProfile.findUnique({
    where: { userId },
  })

  if (!profile) {
    profile = await prisma.aIUserProfile.create({
      data: {
        userId,
        sleeperUsername,
      },
    })
  } else if (sleeperUsername && profile.sleeperUsername !== sleeperUsername) {
    profile = await prisma.aIUserProfile.update({
      where: { userId },
      data: { sleeperUsername },
    })
  }

  return profile
}

export async function getUserToneSettings(userId: string): Promise<UserToneSettings> {
  const profile = await prisma.aIUserProfile.findUnique({
    where: { userId },
  })

  if (!profile) {
    return DEFAULT_TONE_SETTINGS
  }

  return {
    tone: profile.toneMode as 'professional' | 'unfiltered',
    detail: profile.detailLevel === 'detailed' ? 'detailed' : 'concise',
    risk: profile.riskMode as 'conservative' | 'aggressive',
    style: profile.humorLevel === 'high' ? 'entertaining' : 'coaching',
  }
}

export async function updateUserToneSettings(
  userId: string,
  settings: Partial<{
    toneMode: string
    detailLevel: string
    riskMode: string
    humorLevel: string
  }>
): Promise<AIUserProfile> {
  return prisma.aIUserProfile.upsert({
    where: { userId },
    create: { userId, ...settings },
    update: settings,
  })
}

export async function getOrCreateLeagueContext(
  leagueId: string,
  defaults?: Partial<{
    sport: string
    format: string
    sfEnabled: boolean
    tepPremium: boolean
    scoringSettings: any
    rosterSettings: any
  }>
): Promise<AILeagueContext> {
  let context = await prisma.aILeagueContext.findUnique({
    where: { leagueId },
  })

  if (!context) {
    context = await prisma.aILeagueContext.create({
      data: {
        leagueId,
        ...defaults,
      },
    })
  }

  return context
}

export async function updateLeaguePhase(leagueId: string, phase: string): Promise<AILeagueContext> {
  return prisma.aILeagueContext.upsert({
    where: { leagueId },
    create: { leagueId, phase },
    update: { phase },
  })
}

export async function createTeamSnapshot(data: {
  leagueId: string
  teamId: string
  sleeperUsername?: string
  windowStatus: string
  winNowScore: number
  futureValueScore: number
  qbStabilityScore?: number
  rbDependencyScore?: number
  pickInventory?: any
  notes?: string
}): Promise<AITeamStateSnapshot> {
  await prisma.aILeagueContext.upsert({
    where: { leagueId: data.leagueId },
    create: { leagueId: data.leagueId },
    update: {},
  })

  return prisma.aITeamStateSnapshot.create({
    data: {
      leagueId: data.leagueId,
      teamId: data.teamId,
      sleeperUsername: data.sleeperUsername,
      windowStatus: data.windowStatus,
      winNowScore: data.winNowScore,
      futureValueScore: data.futureValueScore,
      qbStabilityScore: data.qbStabilityScore ?? 50,
      rbDependencyScore: data.rbDependencyScore ?? 50,
      pickInventory: data.pickInventory ?? {},
      notes: data.notes,
    },
  })
}

export async function getTeamSnapshots(
  leagueId: string,
  teamId: string,
  limit: number = 12
): Promise<AITeamStateSnapshot[]> {
  return prisma.aITeamStateSnapshot.findMany({
    where: { leagueId, teamId },
    orderBy: { computedAt: 'desc' },
    take: limit,
  })
}

export async function recordMemoryEvent(data: {
  userId?: string
  leagueId?: string
  teamId?: string
  eventType: string
  subject: string
  content: any
  confidence?: number
}): Promise<AIMemoryEvent> {
  const confidence = data.confidence ?? 0.7

  let expiresAt: Date | null = null
  if (confidence < 0.6) {
    expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  } else if (confidence < 0.8) {
    expiresAt = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000)
  }

  return prisma.aIMemoryEvent.create({
    data: {
      userId: data.userId,
      leagueId: data.leagueId,
      teamId: data.teamId,
      eventType: data.eventType,
      subject: data.subject,
      content: data.content,
      confidence,
      expiresAt,
    },
  })
}

export async function getRecentMemoryEvents(options: {
  userId?: string
  leagueId?: string
  eventTypes?: string[]
  limit?: number
}): Promise<AIMemoryEvent[]> {
  const where: any = {
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
    ],
  }

  if (options.userId) where.userId = options.userId
  if (options.leagueId) where.leagueId = options.leagueId
  if (options.eventTypes?.length) where.eventType = { in: options.eventTypes }

  return prisma.aIMemoryEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 20,
  })
}

export async function recordUserFeedback(data: {
  userId: string
  leagueId?: string
  actionType: string
  referenceId?: string
  referenceType?: string
  result?: any
}): Promise<void> {
  await prisma.aIUserFeedback.create({
    data: {
      userId: data.userId,
      leagueId: data.leagueId,
      actionType: data.actionType,
      referenceId: data.referenceId,
      referenceType: data.referenceType,
      result: data.result,
    },
  })
}

export async function detectUserPatterns(userId: string): Promise<string[]> {
  const patterns: string[] = []

  const events = await prisma.aIMemoryEvent.findMany({
    where: {
      userId,
      eventType: { in: ['trade_eval', 'waiver_reco', 'habit_detected'] },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  const subjectCounts: Record<string, number> = {}
  for (const event of events) {
    const subject = event.subject.toLowerCase()
    if (subject.includes('rb') || subject.includes('running back')) {
      subjectCounts['rb_focus'] = (subjectCounts['rb_focus'] || 0) + 1
    }
    if (subject.includes('pick') || subject.includes('draft')) {
      subjectCounts['pick_focus'] = (subjectCounts['pick_focus'] || 0) + 1
    }
    if (subject.includes('overpay')) {
      subjectCounts['overpay_tendency'] = (subjectCounts['overpay_tendency'] || 0) + 1
    }
  }

  const feedback = await prisma.aIUserFeedback.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const actionCounts: Record<string, number> = {}
  for (const fb of feedback) {
    actionCounts[fb.actionType] = (actionCounts[fb.actionType] || 0) + 1
  }

  if (actionCounts['ignored_reco'] > (actionCounts['claimed_player'] || 0) * 2) {
    patterns.push("You tend to ignore waiver recommendations")
  }
  if (actionCounts['rejected_trade'] > (actionCounts['accepted_trade'] || 0) * 3) {
    patterns.push("You usually hesitate to trade")
  }
  if (subjectCounts['rb_focus'] > 10) {
    patterns.push("You consistently focus on RB stability")
  }
  if (subjectCounts['pick_focus'] > 10) {
    patterns.push("You value draft picks highly")
  }
  if (subjectCounts['overpay_tendency'] > 5) {
    patterns.push("You've been flagged for overpaying in trades")
  }

  return patterns
}

export async function getFullAIContext(options: {
  userId?: string
  sleeperUsername?: string
  leagueId?: string
  teamId?: string
}): Promise<AIMemoryContext> {
  const { userId, sleeperUsername, leagueId, teamId } = options

  let userProfile: AIUserProfile | null = null
  if (userId) {
    userProfile = await prisma.aIUserProfile.findUnique({
      where: { userId },
    })
  } else if (sleeperUsername) {
    userProfile = await prisma.aIUserProfile.findFirst({
      where: { sleeperUsername },
    })
  }

  /*
   * 🛑 THE `leagueId` ARRIVES FROM A REQUEST BODY AND WAS TRUSTED. Traced
   * 2026-09-11 from `app/api/chat/chimmy/route.ts`: `leagueId` comes off the
   * form, and the route refuses an unauthorized one ONLY when the question is
   * classified as needing league grounding. For every other question the id is
   * never nulled, flows into `planInput`, and lands here — where the three reads
   * below were keyed on it with no viewer column at all.
   *
   * ⚠ THE SIXTEEN BUILDERS IN THAT ROUTE ARE ALREADY CLOSED, which is what made
   * this one easy to miss: they were gated on the authorized `leagueSnapshot`,
   * and `leagueSnapshot` is null when grounding fails. This function does not
   * take the snapshot — it takes the raw id — so that fix did not reach it.
   *
   * ⚠ GATED HERE RATHER THAN AT THE CALLER because there are two callers
   * (`chimmy-memory-context.ts` and the chat route) and the next one will not
   * know to pass an authorized id. Membership is proved once, and an id that
   * cannot be proved is simply not used.
   */
  let authorizedLeagueId: string | undefined
  if (leagueId && userId) {
    const membership = await resolveLeagueMembership(leagueId, userId)
    if (membership.ok) authorizedLeagueId = leagueId
  }

  let leagueContext: AILeagueContext | null = null
  if (authorizedLeagueId) {
    leagueContext = await prisma.aILeagueContext.findUnique({
      where: { leagueId: authorizedLeagueId },
    })
  }

  let teamSnapshots: AITeamStateSnapshot[] = []
  if (authorizedLeagueId && teamId) {
    teamSnapshots = await getTeamSnapshots(authorizedLeagueId, teamId, 6)
  }

  /*
   * 🛑 AND THIS ONE FAILED OPEN IN A SECOND, QUIETER WAY. `getRecentMemoryEvents`
   * applies its viewer filter only `if (options.userId)` (see :253), so a null
   * `userProfile` made `where.userId` vanish and the query became league-wide
   * over every user's memory events. With no league either, `where` was `{}` —
   * the ten most recent memory events in the system, for anyone.
   *
   * ⚠ A SILENTLY-OPTIONAL FILTER IS ITS OWN BUG CLASS: nothing throws and the
   * rows look normal. So the viewer is resolved explicitly, and when there is no
   * viewer to scope by there is no query.
   */
  const eventViewerId = userId ?? userProfile?.userId
  const recentEvents = eventViewerId
    ? await getRecentMemoryEvents({
        userId: eventViewerId,
        leagueId: authorizedLeagueId,
        limit: 10,
      })
    : []

  let patterns: string[] = []
  if (userProfile?.userId) {
    patterns = await detectUserPatterns(userProfile.userId)
  }

  return {
    userProfile,
    leagueContext,
    teamSnapshots,
    recentEvents,
    patterns,
  }
}

export function buildMemoryPromptSection(context: AIMemoryContext): string {
  const sections: string[] = []

  if (context.userProfile) {
    const profile = context.userProfile
    const strategyBias = profile.strategyBias as any
    const behaviorMetrics = profile.behaviorMetrics as any

    sections.push(`
## USER PROFILE (from memory)
- Tone: ${profile.toneMode}
- Detail Level: ${profile.detailLevel}
- Risk Mode: ${profile.riskMode}
- Personalization: ${profile.personalizeEnabled ? 'enabled' : 'disabled'}

Strategy Tendencies:
- Prefers picks: ${strategyBias?.prefers_picks ?? 0.5}/1
- Prefers youth: ${strategyBias?.prefers_youth ?? 0.5}/1
- RB aversion: ${strategyBias?.rb_aversion ?? 0.3}/1
- QB priority: ${strategyBias?.qb_priority ?? 0.5}/1
`)
  }

  if (context.leagueContext) {
    const league = context.leagueContext
    const market = league.marketBaselines as any

    sections.push(`
## LEAGUE CONTEXT (from memory)
- Sport: ${league.sport}
- Format: ${league.format}
- Superflex: ${league.sfEnabled ? 'YES' : 'NO'}
- TEP: ${league.tepPremium ? 'YES' : 'NO'}
- Current Phase: ${league.phase}

Market Baselines:
- QB Price Index: ${market?.qb_price_index ?? 1.0}
- RB Price Index: ${market?.rb_price_index ?? 1.0}
- Pick Liquidity: ${market?.pick_liquidity_index ?? 1.0}
`)
  }

  if (context.teamSnapshots.length > 0) {
    const latest = context.teamSnapshots[0]
    const history = context.teamSnapshots.slice(0, 4).map(s =>
      `${new Date(s.computedAt).toLocaleDateString()}: ${s.windowStatus} (Win-Now: ${s.winNowScore}, Future: ${s.futureValueScore})`
    ).join('\n')

    sections.push(`
## TEAM TRAJECTORY (from memory)
Current Status: ${latest.windowStatus}
- Win-Now Score: ${latest.winNowScore}/100
- Future Value Score: ${latest.futureValueScore}/100
- QB Stability: ${latest.qbStabilityScore}/100
- RB Dependency: ${latest.rbDependencyScore}/100

Recent History:
${history}
${latest.notes ? `\nNotes: ${latest.notes}` : ''}
`)
  }

  if (context.patterns.length > 0) {
    sections.push(`
## DETECTED PATTERNS (from memory)
${context.patterns.map(p => `- ${p}`).join('\n')}

Use these patterns to personalize your response. Reference them naturally like:
"Based on your history, you tend to..."
"I know you usually hesitate to..."
`)
  }

  if (context.recentEvents.length > 0) {
    const eventSummaries = context.recentEvents.slice(0, 5).map(e =>
      `- ${e.eventType}: ${e.subject} (${new Date(e.createdAt).toLocaleDateString()})`
    ).join('\n')

    sections.push(`
## RECENT AI INTERACTIONS (from memory)
${eventSummaries}
`)
  }

  return sections.join('\n')
}

export async function cleanupExpiredMemory(): Promise<number> {
  const result = await prisma.aIMemoryEvent.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  })

  return result.count
}
