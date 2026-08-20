import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { getEligibleDevyPlayers } from '@/lib/devy-classification'
import { computeAllDevyIntelMetrics, computeDevyFinalScore, computeAvailabilityPctV2 } from '@/lib/devy-intel'
import { prisma } from '@/lib/prisma'

const openai = getOpenAIRouteClient()

interface DevyBoardRequest {
  league_id: string
  user_id?: string
  league_settings?: {
    scoring_type?: string
    is_superflex?: boolean
    te_premium?: boolean
    roster_positions?: string[]
    total_teams?: number
    league_type?: string
  }
  roster?: {
    players?: Array<{ name: string; position: string; age?: number }>
    picks?: Array<{ round: number; pick: number; original_owner?: string }>
  }
  team_record?: { wins: number; losses: number }
}

interface DevyPlayerResult {
  name: string
  position: string
  school: string
  tier: 'Tier 1' | 'Tier 2' | 'Sleeper'
  draftValue: number
  availabilityPct: number
  whyBullets: string[]
  needMatch: 'Strong' | 'Medium' | 'Low'
  classYear?: number | null
  conference?: string | null
  devyEligible?: boolean
  graduatedToNFL?: boolean
  nflTeam?: string | null
  sleeperId?: string | null
  badge?: 'NCAA' | 'NFL' | 'Graduated'
  statSeason?: number | null
  passingYards?: number | null
  rushingYards?: number | null
  receivingYards?: number | null
  receivingTDs?: number | null
  recruitingComposite?: number | null
  breakoutAge?: number | null
  draftProjectionScore?: number | null
  projectedDraftRound?: number | null
  projectedDraftPick?: number | null
  devyAdp?: number | null
  injurySeverityScore?: number | null
  transferStatus?: boolean
  redshirtStatus?: boolean
  athleticProfileScore?: number | null
  productionIndex?: number | null
  volatilityScore?: number | null
  finalScore?: number | null
  scoreBreakdown?: {
    draftProjectionComponent: number
    adpMarketComponent: number
    leagueNeedComponent: number
    scarcityComponent: number
    volatilityComponent: number
  } | null
  riskBand?: 'LOW' | 'MEDIUM' | 'HIGH'
}

interface DevyBoardResponse {
  updatedAt: string
  confidence: 'High' | 'Learning' | 'Evolving'
  dataSource: 'database' | 'ai_only' | 'hybrid'
  leagueContext: {
    format: string
    teams: number
    scoring: string
    yourPick: string
    teamDirection: string
    biggestNeed: string
  }
  topTargets: DevyPlayerResult[]
  fallbacks: DevyPlayerResult[]
  projectedPicksAhead: Array<{ name: string; pct: number }>
  updateReasons: string[]
  totalClassifiedPlayers?: number
}

function computeRiskBand(player: any): 'LOW' | 'MEDIUM' | 'HIGH' {
  const risk =
    (player.injurySeverityScore ?? 0) * 0.4 +
    (player.transferStatus ? 10 : 0) +
    (player.redshirtStatus ? 5 : 0)

  if (risk < 20) return 'LOW'
  if (risk < 50) return 'MEDIUM'
  return 'HIGH'
}

function assignTier(devyValue: number): 'Tier 1' | 'Tier 2' | 'Sleeper' {
  if (devyValue >= 7000) return 'Tier 1'
  if (devyValue >= 4000) return 'Tier 2'
  return 'Sleeper'
}

function assignNeedMatch(position: string, biggestNeed: string, secondaryNeed: string): 'Strong' | 'Medium' | 'Low' {
  if (position === biggestNeed) return 'Strong'
  if (position === secondaryNeed) return 'Medium'
  return 'Low'
}

function computeSecondaryNeed(rosterPositions: string[], isSF: boolean, isTEP: boolean, biggestNeed: string): string {
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  for (const p of rosterPositions) if (counts[p] !== undefined) counts[p]++

  const needs = Object.entries(counts)
    .filter(([pos]) => pos !== biggestNeed)
    .sort(([, a], [, b]) => a - b)

  return needs[0]?.[0] || 'WR'
}

export const POST = withApiUsage({ endpoint: "/api/legacy/devy-board", tool: "LegacyDevyBoard" })(async (req: NextRequest) => {
  try {
    const body: DevyBoardRequest = await req.json()
    const { league_id, league_settings, roster, team_record } = body

    if (!league_id) {
      return NextResponse.json({ error: 'league_id is required' }, { status: 400 })
    }

    const totalTeams = league_settings?.total_teams || 12
    const isSF = league_settings?.is_superflex || false
    const isTEP = league_settings?.te_premium || false
    const leagueType = league_settings?.league_type || 'dynasty'

    const userPicks = roster?.picks || []
    const firstPick = userPicks.length > 0
      ? `${userPicks[0].round}.${String(userPicks[0].pick).padStart(2, '0')}`
      : '1.08'
    const pickNumber = Math.max(1, userPicks.length > 0 ? userPicks[0].pick : 8)

    const record = team_record || { wins: 5, losses: 7 }
    const isContender = record.wins > record.losses
    const teamDirection = isContender ? 'Contender' : 'Rebuilder'

    const rosterPositions = roster?.players?.map(p => p.position) || []
    const qbCount = rosterPositions.filter(p => p === 'QB').length
    const rbCount = rosterPositions.filter(p => p === 'RB').length
    const teCount = rosterPositions.filter(p => p === 'TE').length

    let biggestNeed = 'WR'
    if (isSF && qbCount < 2) biggestNeed = 'QB'
    else if (rbCount < 3) biggestNeed = 'RB'
    else if (teCount < 1 && isTEP) biggestNeed = 'TE'

    const secondaryNeed = computeSecondaryNeed(rosterPositions, isSF, isTEP, biggestNeed)

    const dbPlayerCount = await prisma.devyPlayer.count({ where: { devyEligible: true } })
    const hasDBData = dbPlayerCount >= 20

    let dataSource: 'database' | 'ai_only' | 'hybrid' = 'ai_only'
    let topTargets: DevyPlayerResult[] = []
    let fallbacks: DevyPlayerResult[] = []
    let projectedPicksAhead: Array<{ name: string; pct: number }> = []
    let updateReasons: string[] = []

    if (hasDBData) {
      dataSource = 'hybrid'

      const needPlayers = await getEligibleDevyPlayers({ position: biggestNeed, limit: 10, minValue: 3000 })
      const secondaryPlayers = await getEligibleDevyPlayers({ position: secondaryNeed, limit: 5, minValue: 3000 })
      const otherPlayers = await getEligibleDevyPlayers({ limit: 10, minValue: 5000 })

      const allCandidates = [...needPlayers, ...secondaryPlayers, ...otherPlayers.filter(p =>
        !needPlayers.find(n => n.id === p.id) && !secondaryPlayers.find(s => s.id === p.id)
      )]

      const safeCandidates = allCandidates.filter(p => p.graduatedToNFL !== true && p.devyEligible !== false)

      const finalScoreOpts = { biggestNeed, secondaryNeed, isSF, isTEP, totalTeams, pickNumber }

      safeCandidates.sort((a, b) => {
        // Unscorable players sort last rather than comparing against null.
        const aScore = computeDevyFinalScore(a, finalScoreOpts)?.finalScore ?? -1
        const bScore = computeDevyFinalScore(b, finalScoreOpts)?.finalScore ?? -1
        return bScore - aScore
      })

      const toResult = (p: any): DevyPlayerResult => {
        const metrics = computeAllDevyIntelMetrics(p)
        const fs = computeDevyFinalScore(p, finalScoreOpts)

        return {
          name: p.name,
          position: p.position,
          school: p.school,
          tier: assignTier(p.devyValue),
          draftValue: Math.round(p.devyValue / 100),
          availabilityPct: computeAvailabilityPctV2(p, pickNumber, totalTeams),
          whyBullets: generateWhyBullets(p, biggestNeed, teamDirection),
          needMatch: assignNeedMatch(p.position, biggestNeed, secondaryNeed),
          classYear: p.classYear,
          conference: p.conference,
          devyEligible: p.devyEligible,
          graduatedToNFL: p.graduatedToNFL,
          nflTeam: p.nflTeam,
          sleeperId: p.sleeperId,
          badge: p.graduatedToNFL ? 'Graduated' : p.devyEligible ? 'NCAA' : 'NFL',
          statSeason: p.statSeason,
          passingYards: p.passingYards,
          rushingYards: p.rushingYards,
          receivingYards: p.receivingYards,
          receivingTDs: p.receivingTDs,
          recruitingComposite: metrics.recruitingComposite,
          breakoutAge: metrics.breakoutAge,
          draftProjectionScore: metrics.draftProjectionScore,
          projectedDraftRound: metrics.projectedDraftRound,
          projectedDraftPick: metrics.projectedDraftPick,
          devyAdp: p.devyAdp,
          injurySeverityScore: metrics.injurySeverityScore,
          transferStatus: p.transferStatus,
          redshirtStatus: p.redshirtStatus,
          athleticProfileScore: metrics.athleticProfileScore,
          productionIndex: metrics.productionIndex,
          volatilityScore: metrics.volatilityScore,
          finalScore: fs?.finalScore ?? null,
          // No final score means no breakdown to explain — null, not a row of zeros.
          scoreBreakdown: fs
            ? {
                draftProjectionComponent: fs.draftProjectionComponent,
                adpMarketComponent: fs.adpMarketComponent,
                leagueNeedComponent: fs.leagueNeedComponent,
                scarcityComponent: fs.scarcityComponent,
                volatilityComponent: fs.volatilityComponent,
              }
            : null,
          riskBand: computeRiskBand(p),
        }
      }

      if (safeCandidates.length < 6) {
        const aiFallback = await generateFromAI(biggestNeed, teamDirection, isSF, isTEP, totalTeams, firstPick, leagueType)
        const dbResults = safeCandidates.map(toResult)
        const verifiedAiTargets = (aiFallback.topTargets || []).filter((p: any) =>
          !dbResults.find((d: DevyPlayerResult) => d.name.toLowerCase() === p.name?.toLowerCase())
        )
        topTargets = [...dbResults, ...verifiedAiTargets].slice(0, 6)
        fallbacks = aiFallback.fallbacks || []
        projectedPicksAhead = aiFallback.projectedPicksAhead || []
        updateReasons = [
          `${safeCandidates.length} classified players found — supplemented with AI`,
          `${biggestNeed} prioritized based on roster analysis`,
          `${teamDirection} strategy applied to rankings`,
        ]
        dataSource = 'hybrid'
      } else {
        topTargets = safeCandidates.slice(0, 6).map(toResult)
        fallbacks = safeCandidates.slice(6, 9).map(toResult)

        const topProspects = safeCandidates.slice(0, pickNumber - 1)
        projectedPicksAhead = topProspects.map(p => ({
          name: p.name,
          pct: Math.min(95, Math.round(p.devyValue / 100)),
        }))

        updateReasons = [
          `${dbPlayerCount} classified college players in database`,
          `${biggestNeed} prioritized based on roster analysis`,
          `${teamDirection} strategy applied to rankings`,
          isSF ? 'Superflex QB premium factored in' : 'Standard QB valuation applied',
        ]

        try {
          const playerSummary = topTargets.slice(0, 3).map(p =>
            `${p.name} (${p.position}, ${p.school}, value: ${p.draftValue})`
          ).join(', ')

          const narrativePrompt = `Generate 2-sentence "why" bullets for these top devy prospects for a ${teamDirection} in a ${isSF ? 'Superflex' : '1QB'} dynasty league needing ${biggestNeed}:\n${playerSummary}\n\nReturn JSON array of objects: [{"name": "...", "bullets": ["...", "..."]}]. Return ONLY valid JSON.`

          const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: narrativePrompt }],
            temperature: 0.6,
            max_tokens: 600,
          })

          const content = completion.choices[0]?.message?.content || ''
          const cleaned = content.replace(/```json\n?|\n?```/g, '').trim()
          const narratives = JSON.parse(cleaned)

          for (const n of narratives) {
            const target = topTargets.find(t => t.name === n.name)
            if (target && Array.isArray(n.bullets)) {
              target.whyBullets = n.bullets.slice(0, 3)
            }
          }
        } catch {
        }
      }
    } else {
      const aiResult = await generateFromAI(biggestNeed, teamDirection, isSF, isTEP, totalTeams, firstPick, leagueType)
      topTargets = aiResult.topTargets
      fallbacks = aiResult.fallbacks
      projectedPicksAhead = aiResult.projectedPicksAhead
      updateReasons = aiResult.updateReasons
    }

    const response: DevyBoardResponse = {
      updatedAt: new Date().toISOString(),
      confidence: hasDBData ? 'High' : 'Learning',
      dataSource,
      leagueContext: {
        format: `${leagueType.charAt(0).toUpperCase() + leagueType.slice(1)}${leagueType.includes('devy') ? '' : '/Devy'}`,
        teams: totalTeams,
        scoring: isSF ? 'Superflex' : '1QB' + (isTEP ? ' / TEP' : ''),
        yourPick: firstPick,
        teamDirection,
        biggestNeed,
      },
      topTargets,
      fallbacks,
      projectedPicksAhead,
      updateReasons,
      totalClassifiedPlayers: hasDBData ? dbPlayerCount : undefined,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Devy board error:', error)
    return NextResponse.json(
      { error: 'Failed to generate devy board' },
      { status: 500 }
    )
  }
})

function generateWhyBullets(player: any, biggestNeed: string, teamDirection: string): string[] {
  const bullets: string[] = []
  const pos = player.position

  if (pos === biggestNeed) bullets.push(`Fills your biggest roster need at ${pos}`)
  if (player.classYear && player.classYear <= 2) bullets.push('Young prospect with years of college production ahead')
  if (player.devyValue >= 7000) bullets.push('Elite prospect with top-tier dynasty value')
  else if (player.devyValue >= 5000) bullets.push('Strong prospect with solid production profile')

  if (pos === 'QB' && player.passingYards && player.passingYards > 2000) bullets.push(`${player.passingYards} passing yards show pro-ready arm`)
  if (pos === 'RB' && player.rushingYards && player.rushingYards > 800) bullets.push(`${player.rushingYards} rushing yards demonstrate workhorse ability`)
  if ((pos === 'WR' || pos === 'TE') && player.receivingYards && player.receivingYards > 600) bullets.push(`${player.receivingYards} receiving yards show target dominance`)

  if (teamDirection === 'Rebuilder') bullets.push('Ideal long-term asset for your rebuild')
  if (bullets.length === 0) bullets.push('Solid dynasty prospect worth monitoring')

  return bullets.slice(0, 3)
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z]/g, '').trim()
}

interface DevyVerificationData {
  eligibleNames: Set<string>
  graduateNames: Set<string>
  graduateList: string
  backfillPlayers: any[]
}

async function loadVerificationData(): Promise<DevyVerificationData> {
  const [graduates, eligibles] = await Promise.all([
    prisma.devyPlayer.findMany({
      where: { OR: [{ graduatedToNFL: true }, { league: 'NFL' }, { devyEligible: false }] },
      select: { name: true, nflTeam: true },
    }),
    prisma.devyPlayer.findMany({
      where: { devyEligible: true, graduatedToNFL: false, league: 'NCAA' },
      select: { name: true, position: true, school: true, devyValue: true },
      orderBy: { devyValue: 'desc' },
      take: 200,
    }),
  ])

  return {
    eligibleNames: new Set(eligibles.map(p => normalizeName(p.name))),
    graduateNames: new Set(graduates.map(p => normalizeName(p.name))),
    graduateList: graduates.slice(0, 50).map(p => `${p.name} (${p.nflTeam || 'NFL'})`).join(', '),
    backfillPlayers: eligibles,
  }
}

function verifyAndBackfill(
  aiResult: any,
  verification: DevyVerificationData,
  biggestNeed: string,
  secondaryNeed?: string,
): any {
  function isAllowed(playerEntry: { name: string; school?: string; position?: string }): boolean {
    const norm = normalizeName(playerEntry.name)
    if (verification.graduateNames.has(norm)) return false
    if (!verification.eligibleNames.has(norm)) return false
    return true
  }

  if (Array.isArray(aiResult.topTargets)) {
    aiResult.topTargets = aiResult.topTargets.filter((p: any) => isAllowed(p))
  }
  if (Array.isArray(aiResult.fallbacks)) {
    aiResult.fallbacks = aiResult.fallbacks.filter((p: any) => isAllowed(p))
  }
  if (Array.isArray(aiResult.projectedPicksAhead)) {
    aiResult.projectedPicksAhead = aiResult.projectedPicksAhead.filter((p: any) => isAllowed(p))
  }

  const existingNames = new Set([
    ...(aiResult.topTargets || []).map((p: any) => normalizeName(p.name)),
    ...(aiResult.fallbacks || []).map((p: any) => normalizeName(p.name)),
  ])

  if ((aiResult.topTargets?.length || 0) < 6) {
    const needed = 6 - (aiResult.topTargets?.length || 0)
    const backfill = verification.backfillPlayers
      .filter(p => !existingNames.has(normalizeName(p.name)))
      .sort((a, b) => {
        const aMatch = a.position === biggestNeed ? 2 : a.position === secondaryNeed ? 1 : 0
        const bMatch = b.position === biggestNeed ? 2 : b.position === secondaryNeed ? 1 : 0
        if (bMatch !== aMatch) return bMatch - aMatch
        return (b.devyValue || 0) - (a.devyValue || 0)
      })
      .slice(0, needed)
      .map(p => ({
        name: p.name,
        position: p.position,
        school: p.school,
        tier: assignTier(p.devyValue || 0),
        draftValue: Math.round((p.devyValue || 0) / 100),
        availabilityPct: 50,
        whyBullets: ['Database-verified college prospect', `${p.position} with strong production`],
        needMatch: p.position === biggestNeed ? 'Strong' as const : p.position === secondaryNeed ? 'Medium' as const : 'Low' as const,
        badge: 'NCAA' as const,
      }))

    aiResult.topTargets = [...(aiResult.topTargets || []), ...backfill].slice(0, 6)
    for (const p of backfill) existingNames.add(normalizeName(p.name))
  }

  if ((aiResult.fallbacks?.length || 0) < 2) {
    const needed = 3 - (aiResult.fallbacks?.length || 0)
    const backfill = verification.backfillPlayers
      .filter(p => !existingNames.has(normalizeName(p.name)))
      .slice(0, needed)
      .map(p => ({
        name: p.name,
        position: p.position,
        school: p.school,
        tier: 'Sleeper' as const,
        draftValue: Math.round((p.devyValue || 0) / 100),
        availabilityPct: 70,
        whyBullets: ['Database-verified college prospect', 'Sleeper value pick'],
        needMatch: 'Low' as const,
        badge: 'NCAA' as const,
      }))

    aiResult.fallbacks = [...(aiResult.fallbacks || []), ...backfill].slice(0, 3)
  }

  return aiResult
}

async function generateFromAI(biggestNeed: string, teamDirection: string, isSF: boolean, isTEP: boolean, totalTeams: number, firstPick: string, leagueType: string) {
  const currentYear = new Date().getFullYear()
  const verification = await loadVerificationData()

  try {
    const prompt = `You are a fantasy football devy draft expert. Today is February ${currentYear}. Generate draft recommendations for a ${leagueType} league.

CRITICAL RULES:
1. ONLY recommend college players who are CURRENTLY enrolled in college for the ${currentYear} season.
2. Do NOT include any player who was drafted into the NFL in any previous draft.
3. Do NOT include any player currently on an NFL roster.
4. Players who declared for the NFL Draft and were selected are NOT eligible.

KNOWN NFL PLAYERS TO EXCLUDE (these have already graduated to the NFL):
${verification.graduateList}

League Context:
- Format: ${leagueType} (${isSF ? 'Superflex' : '1QB'})
- Teams: ${totalTeams}
- TE Premium: ${isTEP ? 'Yes' : 'No'}
- User's Pick: ${firstPick}
- Team Direction: ${teamDirection}
- Biggest Roster Need: ${biggestNeed}

Generate exactly this JSON with 6 topTargets, 3 fallbacks, 4-6 projectedPicksAhead:
{
  "topTargets": [{"name":"...","position":"QB/RB/WR/TE","school":"...","tier":"Tier 1/Tier 2/Sleeper","draftValue":85,"availabilityPct":70,"whyBullets":["...","..."],"needMatch":"Strong/Medium/Low"}],
  "fallbacks": [...],
  "projectedPicksAhead": [{"name":"...","pct":85}],
  "updateReasons": ["...","...","..."]
}
Return ONLY valid JSON.`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000,
    })

    const content = completion.choices[0]?.message?.content || ''
    const cleaned = content.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return verifyAndBackfill(parsed, verification, biggestNeed)
  } catch {
    const fallback = generateFallbackData(biggestNeed, teamDirection, isSF)
    return verifyAndBackfill(fallback, verification, biggestNeed)
  }
}

function generateFallbackData(biggestNeed: string, teamDirection: string, isSF: boolean) {
  const prospects: Record<string, DevyPlayerResult[]> = {
    QB: [
      { name: 'Arch Manning', position: 'QB', school: 'Texas', tier: 'Tier 1', draftValue: 95, availabilityPct: 25, whyBullets: ['Elite pedigree and arm talent', 'Perfect SF asset'], needMatch: 'Strong', badge: 'NCAA' },
      { name: 'Dylan Raiola', position: 'QB', school: 'Nebraska', tier: 'Tier 1', draftValue: 88, availabilityPct: 40, whyBullets: ['Pro-ready mechanics', 'High football IQ'], needMatch: 'Strong', badge: 'NCAA' },
      { name: 'Julian Sayin', position: 'QB', school: 'Ohio State', tier: 'Tier 2', draftValue: 78, availabilityPct: 60, whyBullets: ['Excellent accuracy', 'Rising prospect'], needMatch: 'Medium', badge: 'NCAA' },
    ],
    RB: [
      { name: 'Jerrick Gibson', position: 'RB', school: 'LSU', tier: 'Tier 1', draftValue: 90, availabilityPct: 35, whyBullets: ['Elite speed and vision', 'Workhorse potential'], needMatch: 'Strong', badge: 'NCAA' },
      { name: 'Quinten Joyner', position: 'RB', school: 'USC', tier: 'Tier 1', draftValue: 85, availabilityPct: 45, whyBullets: ['Complete skillset', 'Pass-catching ability'], needMatch: 'Strong', badge: 'NCAA' },
      { name: 'Rueben Owens', position: 'RB', school: 'Louisville', tier: 'Tier 2', draftValue: 75, availabilityPct: 55, whyBullets: ['Explosive athlete', 'Breakout potential'], needMatch: 'Medium', badge: 'NCAA' },
    ],
    WR: [
      { name: 'Jeremiah Smith', position: 'WR', school: 'Ohio State', tier: 'Tier 1', draftValue: 98, availabilityPct: 15, whyBullets: ['Generational talent', 'Elite size/speed combo'], needMatch: 'Strong', badge: 'NCAA' },
      { name: 'Ryan Williams', position: 'WR', school: 'Alabama', tier: 'Tier 1', draftValue: 92, availabilityPct: 30, whyBullets: ['Dynamic playmaker', 'Already producing'], needMatch: 'Strong', badge: 'NCAA' },
      { name: 'Dakorien Moore', position: 'WR', school: 'LSU', tier: 'Tier 2', draftValue: 82, availabilityPct: 50, whyBullets: ['Explosive athlete', 'Big play threat'], needMatch: 'Medium', badge: 'NCAA' },
    ],
    TE: [
      { name: 'Duce Robinson', position: 'TE', school: 'USC', tier: 'Tier 1', draftValue: 85, availabilityPct: 45, whyBullets: ['Elite athleticism', 'Pro-ready frame'], needMatch: 'Strong', badge: 'NCAA' },
      { name: 'Eli Raridon', position: 'TE', school: 'Notre Dame', tier: 'Tier 2', draftValue: 72, availabilityPct: 65, whyBullets: ['Rising prospect', 'Soft hands'], needMatch: 'Medium', badge: 'NCAA' },
    ],
  }

  const needProspects = prospects[biggestNeed] || prospects.WR
  const otherPositions = Object.keys(prospects).filter(p => p !== biggestNeed)

  const topTargets = [
    ...needProspects.slice(0, 3),
    ...prospects[otherPositions[0]]?.slice(0, 2) || [],
    ...prospects[otherPositions[1]]?.slice(0, 1) || [],
  ].slice(0, 6)

  const fallbacks = [
    { name: 'Johntay Cook II', position: 'WR', school: 'Texas', tier: 'Sleeper' as const, draftValue: 68, availabilityPct: 75, whyBullets: ['Big play ability', 'Value pick'], needMatch: 'Low' as const, badge: 'NCAA' as const },
    { name: 'Quinten Joyner', position: 'RB', school: 'USC', tier: 'Tier 2' as const, draftValue: 70, availabilityPct: 70, whyBullets: ['Underrated talent', 'Safe floor'], needMatch: 'Medium' as const, badge: 'NCAA' as const },
    { name: 'Kyion Grayes', position: 'WR', school: 'Alabama', tier: 'Tier 2' as const, draftValue: 65, availabilityPct: 80, whyBullets: ['Route technician', 'Good value'], needMatch: 'Low' as const, badge: 'NCAA' as const },
  ]

  return {
    topTargets,
    fallbacks,
    projectedPicksAhead: [
      { name: 'Jeremiah Smith', pct: 95 },
      { name: 'Arch Manning', pct: 90 },
      { name: 'Ryan Williams', pct: 85 },
      { name: 'Jerrick Gibson', pct: 80 },
    ],
    updateReasons: [
      `${biggestNeed} prioritized based on roster analysis`,
      `${teamDirection} strategy applied to rankings`,
      isSF ? 'Superflex QB premium factored in' : 'Standard QB valuation applied',
    ],
  }
}
