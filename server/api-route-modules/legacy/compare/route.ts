import { withApiUsage } from "@/lib/telemetry/usage"
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { NextRequest, NextResponse } from 'next/server'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import {
  getSleeperUser,
  getUserLeagues,
  getLeagueRosters,
  getPlayoffBracket,
  getLeagueType,
  SleeperLeague,
  SleeperRoster,
} from '@/lib/sleeper-client'
import { getUniversalAIContext } from '@/lib/ai-player-context'

const openai = getOpenAIRouteClient()

const currentDate = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const COMPARE_SYSTEM_PROMPT = `You are THE ELITE AllFantasy Manager Comparison AI — the ultimate fantasy football analyst.

## CURRENT DATE: ${currentDate}
The 2024 NFL Draft class (Marvin Harrison Jr, Malik Nabers, Jayden Daniels, etc.) have completed their rookie seasons - they are active NFL players with production, not prospects.

${getUniversalAIContext()}

Your job is to compare two fantasy managers FAIRLY by league type and determine who is the better manager.

## CRITICAL: FAIR LEAGUE-TYPE COMPARISON
You MUST compare league types ONLY when BOTH managers have that type:
- If Manager A has 5 dynasty leagues and Manager B has 2 dynasty leagues, compare dynasty-to-dynasty (but note the sample size difference)
- If Manager A has 0 redraft leagues but Manager B has 10 redraft leagues, mark redraft as "N/A - Not Comparable" for the head-to-head
- DO NOT penalize a manager for not playing a certain format - only grade what they actually play
- The overall winner should be determined by formats BOTH managers participate in

## GRADING SCALE
Use letter grades: A+, A, A-, B+, B, B-, C+, C, C-, D, F

## COMPARISON CRITERIA BY LEAGUE TYPE

### Redraft Leagues (Only if BOTH managers have redraft leagues)
- Win percentage (most important)
- Playoff rate
- Championship rate
- Weekly scoring consistency

### Dynasty Leagues (Only if BOTH managers have dynasty leagues)
- Long-term success (multi-year playoff streaks)
- Championship windows (sustained contention)
- Rebuilding efficiency (bouncing back from bad seasons)
- Trade activity and value extraction

### Specialty Leagues - Heavy IDP (Only if BOTH managers have them)
- Adaptation to IDP-heavy formats (3+ IDP starters)
- Defensive positional advantage exploitation
- Format-specific expertise
Note: Superflex leagues are classified under their base type (redraft or dynasty), not specialty.

## EXCLUDED FORMATS (Track but don't grade for comparison)
The following are EXCLUDED from head-to-head comparison:
- **Guillotine leagues**: Elimination format creates artificial losses
- **Best Ball leagues**: No in-season management
- **Survivor leagues**: Elimination format with skewed records
- **Draft-only leagues**: No in-season component

## OVERALL WINNER DETERMINATION
Weight the comparison using ONLY formats where BOTH managers participate:
- Championship rate: 35%
- Win percentage: 25%
- Playoff rate: 25%
- Consistency/longevity: 15%

If managers play completely different formats (one only dynasty, one only redraft), state that a fair comparison is not possible and grade individually.

## OUTPUT FORMAT
Return JSON:
{
  "manager_a": {
    "username": string,
    "overall_grade": string (A+ to F, based on STANDARD leagues: redraft, dynasty, specialty. Excludes bestball/guillotine/survivor),
    "grades_by_type": {
      "redraft": { "grade": string | "N/A", "record": string, "championships": number, "leagues_played": number, "note": string },
      "dynasty": { "grade": string | "N/A", "record": string, "championships": number, "leagues_played": number, "note": string },
      "specialty": { "grade": string | "N/A", "record": string, "championships": number, "leagues_played": number, "note": string }
    },
    "specialty_formats_note": string (mention any guillotine/bestball/survivor leagues as fun fact, not graded),
    "strengths": string[],
    "weaknesses": string[]
  },
  "manager_b": {
    "username": string,
    "overall_grade": string (A+ to F, based on STANDARD leagues: redraft, dynasty, specialty. Excludes bestball/guillotine/survivor),
    "grades_by_type": {
      "redraft": { "grade": string | "N/A", "record": string, "championships": number, "leagues_played": number, "note": string },
      "dynasty": { "grade": string | "N/A", "record": string, "championships": number, "leagues_played": number, "note": string },
      "specialty": { "grade": string | "N/A", "record": string, "championships": number, "leagues_played": number, "note": string }
    },
    "specialty_formats_note": string (mention any guillotine/bestball/survivor leagues as fun fact, not graded),
    "strengths": string[],
    "weaknesses": string[]
  },
  "fair_comparison_possible": boolean (false if managers play completely different formats),
  "comparable_formats": string[] (list of formats both managers play: "redraft", "dynasty", "specialty"),
  "winner": "A" | "B" | "TIE" | "INCOMPARABLE",
  "winner_username": string,
  "margin": "DOMINANT" | "CLEAR" | "SLIGHT" | "TIE" | "INCOMPARABLE",
  "verdict": string (2-3 sentence summary - if incomparable, explain why and give individual assessments),
  "head_to_head_breakdown": {
    "redraft_winner": "A" | "B" | "TIE" | "N/A",
    "dynasty_winner": "A" | "B" | "TIE" | "N/A",
    "specialty_winner": "A" | "B" | "TIE" | "N/A"
  },
  "trash_talk": string (fun roast of the loser, keep it playful - if incomparable, roast both equally)
}`

interface LeagueStats {
  type: string
  wins: number
  losses: number
  ties: number
  championships: number
  playoffs: number
  leagues: number
}

interface FetchedLeague {
  league_id: string
  name: string
  season: string
  leagueType: string
  roster: {
    wins: number
    losses: number
    ties: number
    isChampion: boolean
    playoffSeed: number | null
  } | null
}

async function fetchUserDataFromSleeper(username: string): Promise<{
  user: { sleeper_id: string; username: string; display_name: string }
  leagues: FetchedLeague[]
} | null> {
  const sleeperUser = await getSleeperUser(username)
  if (!sleeperUser) return null

  const seasons = ['2024', '2023', '2022', '2021', '2020']
  const allLeagues: FetchedLeague[] = []

  for (const season of seasons) {
    try {
      const leagues = await getUserLeagues(sleeperUser.user_id, 'nfl', season)
      
      for (const league of leagues) {
        if (league.status !== 'complete' && league.status !== 'in_season') continue

        const [rosters, bracket] = await Promise.all([
          getLeagueRosters(league.league_id),
          getPlayoffBracket(league.league_id),
        ])

        const userRoster = rosters.find((r: SleeperRoster) => r.owner_id === sleeperUser.user_id)
        if (!userRoster) continue

        let isChampion = false
        if (bracket && bracket.length > 0) {
          const finalMatch = bracket.find((m) => m.r === Math.max(...bracket.map((b) => b.r)) && m.m === 1)
          if (finalMatch && finalMatch.w === userRoster.roster_id) {
            isChampion = true
          }
        }

        const leagueType = getLeagueTypeExtended(league)

        allLeagues.push({
          league_id: league.league_id,
          name: league.name,
          season: league.season,
          leagueType,
          roster: {
            wins: userRoster.settings?.wins || 0,
            losses: userRoster.settings?.losses || 0,
            ties: userRoster.settings?.ties || 0,
            isChampion,
            playoffSeed: userRoster.settings?.rank || null,
          },
        })
      }
    } catch (e) {
      console.error(`Error fetching ${season} leagues for ${username}:`, e)
    }
  }

  return {
    user: {
      sleeper_id: sleeperUser.user_id,
      username: sleeperUser.username,
      display_name: sleeperUser.display_name || sleeperUser.username,
    },
    leagues: allLeagues,
  }
}

function getLeagueTypeExtended(league: SleeperLeague): string {
  const settings = league.settings as Record<string, unknown>
  const positions = league.roster_positions || []
  const nameLower = (league.name || '').toLowerCase()
  
  const isGuillotine = nameLower.includes('guillotine') || nameLower.includes('guilotine') || nameLower.includes('survivor elimination')
  const isSurvivor = nameLower.includes('survivor') && !nameLower.includes('survivor elimination')
  const isDraftOnly = settings['type'] === 3 || nameLower.includes('draft only') || nameLower.includes('draft-only')
  const hasBestball = nameLower.includes('bestball') || nameLower.includes('best ball') || settings['best_ball'] === 1
  
  if (isGuillotine) return 'guillotine'
  if (isSurvivor) return 'survivor'
  if (isDraftOnly) return 'draft_only'
  if (hasBestball) return 'bestball'
  
  const type = getLeagueType(league)
  const isDynasty = type === 'dynasty' || type === 'keeper'

  const idpSlots = positions.filter((p: string) => ['DL', 'LB', 'DB', 'IDP_FLEX'].includes(p))
  const isHeavyIDP = idpSlots.length >= 3

  if (isHeavyIDP) return 'specialty'
  if (isDynasty) return 'dynasty'
  return 'redraft'
}

// Check if a league type is a specialty format that should be excluded from main grading
function isSpecialtyFormat(leagueType: string): boolean {
  return ['guillotine', 'survivor', 'draft_only', 'bestball'].includes(leagueType)
}

function aggregateByLeagueType(leagues: FetchedLeague[]): { 
  standard: Record<string, LeagueStats>
  specialty: Record<string, LeagueStats>
  all: Record<string, LeagueStats>
} {
  const standardStats: Record<string, LeagueStats> = {
    redraft: { type: 'redraft', wins: 0, losses: 0, ties: 0, championships: 0, playoffs: 0, leagues: 0 },
    dynasty: { type: 'dynasty', wins: 0, losses: 0, ties: 0, championships: 0, playoffs: 0, leagues: 0 },
    specialty: { type: 'specialty', wins: 0, losses: 0, ties: 0, championships: 0, playoffs: 0, leagues: 0 },
  }
  
  const specialtyStats: Record<string, LeagueStats> = {
    bestball: { type: 'bestball', wins: 0, losses: 0, ties: 0, championships: 0, playoffs: 0, leagues: 0 },
    guillotine: { type: 'guillotine', wins: 0, losses: 0, ties: 0, championships: 0, playoffs: 0, leagues: 0 },
    survivor: { type: 'survivor', wins: 0, losses: 0, ties: 0, championships: 0, playoffs: 0, leagues: 0 },
    draft_only: { type: 'draft_only', wins: 0, losses: 0, ties: 0, championships: 0, playoffs: 0, leagues: 0 },
  }

  for (const league of leagues) {
    const roster = league.roster
    if (!roster) continue

    const leagueType = league.leagueType || 'redraft'
    const isSpecialty = isSpecialtyFormat(leagueType)
    
    const targetStats = isSpecialty ? specialtyStats : standardStats
    if (!targetStats[leagueType]) {
      targetStats[leagueType] = { type: leagueType, wins: 0, losses: 0, ties: 0, championships: 0, playoffs: 0, leagues: 0 }
    }

    targetStats[leagueType].wins += roster.wins || 0
    targetStats[leagueType].losses += roster.losses || 0
    targetStats[leagueType].ties += roster.ties || 0
    targetStats[leagueType].championships += roster.isChampion ? 1 : 0
    targetStats[leagueType].playoffs += (roster.playoffSeed && roster.playoffSeed > 0) ? 1 : 0
    targetStats[leagueType].leagues += 1
  }

  return { 
    standard: standardStats, 
    specialty: specialtyStats,
    all: { ...standardStats, ...specialtyStats }
  }
}

// Deterministic grade backing (audit finding: the letter grades and winner verdict were
// 100% LLM-generated with no code-side verification — the same real stats could yield a
// different grade on different runs). This computes grades from real stats using the exact
// weights the system prompt has always claimed to use (championship 35% / win% 25% /
// playoff 25% / consistency-longevity 15%), so the LLM's stated methodology and the actual
// grade shown to the user are now the same thing, and repeat runs on the same data always
// agree. The LLM is still used for verdict/trash_talk/strengths/weaknesses narrative, but
// every field below is computed here and forced onto the LLM's output afterward.
function scoreToGrade(score: number): string {
  if (score >= 97) return 'A+'
  if (score >= 93) return 'A'
  if (score >= 90) return 'A-'
  if (score >= 87) return 'B+'
  if (score >= 83) return 'B'
  if (score >= 80) return 'B-'
  if (score >= 77) return 'C+'
  if (score >= 73) return 'C'
  if (score >= 70) return 'C-'
  if (score >= 60) return 'D'
  return 'F'
}

// Longevity/consistency proxy: leagues played, capped at 8+ for full credit. Disclosed here
// rather than left as an unverifiable LLM judgment call.
const LONGEVITY_FULL_CREDIT_LEAGUES = 8

function computeWeightedScore(args: {
  wins: number
  losses: number
  championships: number
  playoffs: number
  leagues: number
}): number {
  const { wins, losses, championships, playoffs, leagues } = args
  if (leagues === 0) return 0
  const winPct = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0
  const championshipRate = (championships / leagues) * 100
  const playoffRate = (playoffs / leagues) * 100
  const longevityScore = Math.min(leagues / LONGEVITY_FULL_CREDIT_LEAGUES, 1) * 100
  return championshipRate * 0.35 + winPct * 0.25 + playoffRate * 0.25 + longevityScore * 0.15
}

function computeFormatTypeScore(stats: LeagueStats): number {
  return computeWeightedScore({
    wins: stats.wins,
    losses: stats.losses,
    championships: stats.championships,
    playoffs: stats.playoffs,
    leagues: stats.leagues,
  })
}

function computeScopedScore(stats: Record<string, LeagueStats>, types: string[]): number {
  const totals = types.reduce(
    (acc, type) => {
      const s = stats[type]
      if (!s) return acc
      acc.wins += s.wins
      acc.losses += s.losses
      acc.championships += s.championships
      acc.playoffs += s.playoffs
      acc.leagues += s.leagues
      return acc
    },
    { wins: 0, losses: 0, championships: 0, playoffs: 0, leagues: 0 }
  )
  return computeWeightedScore(totals)
}

function marginFromScoreDiff(diff: number): 'DOMINANT' | 'CLEAR' | 'SLIGHT' | 'TIE' {
  const abs = Math.abs(diff)
  if (abs === 0) return 'TIE'
  if (abs >= 20) return 'DOMINANT'
  if (abs >= 10) return 'CLEAR'
  return 'SLIGHT'
}

function buildManagerSnapshot(
  user: { username: string; display_name: string },
  leagues: FetchedLeague[],
  stats: { standard: Record<string, LeagueStats>; specialty: Record<string, LeagueStats>; all: Record<string, LeagueStats> }
) {
  // Use only standard leagues for overall grading (excludes guillotine, bestball, survivor, draft_only)
  const standardLeagues = leagues.filter(l => !isSpecialtyFormat(l.leagueType))
  const specialtyLeagues = leagues.filter(l => isSpecialtyFormat(l.leagueType))
  
  const standardRosters = standardLeagues.map((l) => l.roster).filter(Boolean)
  const totalWins = standardRosters.reduce((sum, r) => sum + (r?.wins || 0), 0)
  const totalLosses = standardRosters.reduce((sum, r) => sum + (r?.losses || 0), 0)
  const totalTies = standardRosters.reduce((sum, r) => sum + (r?.ties || 0), 0)
  const championships = standardRosters.filter((r) => r?.isChampion).length
  const playoffs = standardRosters.filter((r) => r?.playoffSeed && r.playoffSeed > 0).length
  const seasons = Array.from(new Set(standardLeagues.map((l) => l.season)))

  return {
    username: user.display_name || user.username,
    grading_note: "Overall stats are from STANDARD leagues only. Specialty leagues (guillotine, bestball, survivor) excluded because their format creates skewed records.",
    total_standard_leagues: standardLeagues.length,
    total_specialty_leagues: specialtyLeagues.length,
    total_leagues_all: leagues.length,
    total_seasons: seasons.length,
    overall_record: `${totalWins}-${totalLosses}-${totalTies}`,
    win_percentage: totalWins + totalLosses > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0,
    championships,
    championship_rate: standardLeagues.length > 0 ? Math.round((championships / standardLeagues.length) * 100) : 0,
    playoffs,
    playoff_rate: standardLeagues.length > 0 ? Math.round((playoffs / standardLeagues.length) * 100) : 0,
    standard_stats: stats.standard,
    specialty_stats: stats.specialty,
  }
}

export const POST = withApiUsage({ endpoint: "/api/legacy/compare", tool: "LegacyCompare" })(async (request: NextRequest) => {
  try {
    const ip = getClientIp(request)
    const body = await request.json()
    const { username_a, username_b } = body

    if (!username_a || !username_b) {
      return NextResponse.json({ error: 'Both usernames are required' }, { status: 400 })
    }

    if (username_a.toLowerCase() === username_b.toLowerCase()) {
      return NextResponse.json({ error: 'Cannot compare a manager to themselves' }, { status: 400 })
    }

    const pair = [username_a.trim().toLowerCase(), username_b.trim().toLowerCase()].sort()
    const compareKey = `compare:u:${pair[0]}:${pair[1]}`
    const rl = consumeRateLimit({
      scope: 'legacy',
      action: 'compare',
      sleeperUsername: compareKey,
      ip,
      maxRequests: 5,
      windowMs: 60_000,
      includeIpInKey: false,
    })

    if (!rl.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfterSec: rl.retryAfterSec },
        { status: 429 }
      )
    }

    const [dataA, dataB] = await Promise.all([
      fetchUserDataFromSleeper(username_a),
      fetchUserDataFromSleeper(username_b),
    ])

    if (!dataA) {
      return NextResponse.json({ error: `User "${username_a}" not found on Sleeper` }, { status: 404 })
    }
    if (!dataB) {
      return NextResponse.json({ error: `User "${username_b}" not found on Sleeper` }, { status: 404 })
    }

    if (dataA.leagues.length === 0) {
      return NextResponse.json({ error: `User "${username_a}" has no league history on Sleeper` }, { status: 400 })
    }
    if (dataB.leagues.length === 0) {
      return NextResponse.json({ error: `User "${username_b}" has no league history on Sleeper` }, { status: 400 })
    }

    const statsA = aggregateByLeagueType(dataA.leagues)
    const statsB = aggregateByLeagueType(dataB.leagues)

    const snapshotA = buildManagerSnapshot(dataA.user, dataA.leagues, statsA)
    const snapshotB = buildManagerSnapshot(dataB.user, dataB.leagues, statsB)
    
    // Determine comparable formats (both managers must have leagues of that type)
    const comparableFormats: string[] = []
    const formatComparison: Record<string, { a: number; b: number }> = {}
    
    for (const type of ['redraft', 'dynasty', 'specialty'] as const) {
      const aCount = statsA.standard[type]?.leagues || 0
      const bCount = statsB.standard[type]?.leagues || 0
      formatComparison[type] = { a: aCount, b: bCount }
      if (aCount > 0 && bCount > 0) {
        comparableFormats.push(type)
      }
    }

    // Deterministic grades — computed from real stats before the LLM ever runs, using the
    // exact weights the prompt has always claimed (championship 35% / win% 25% / playoff 25%
    // / longevity 15%). Passed into the prompt as given facts; forced back onto the LLM's
    // JSON after parsing so the LLM cannot silently diverge from them.
    const overallScoreA = computeWeightedScore({
      wins: parseInt(snapshotA.overall_record.split('-')[0], 10) || 0,
      losses: parseInt(snapshotA.overall_record.split('-')[1], 10) || 0,
      championships: snapshotA.championships,
      playoffs: snapshotA.playoffs,
      leagues: snapshotA.total_standard_leagues,
    })
    const overallScoreB = computeWeightedScore({
      wins: parseInt(snapshotB.overall_record.split('-')[0], 10) || 0,
      losses: parseInt(snapshotB.overall_record.split('-')[1], 10) || 0,
      championships: snapshotB.championships,
      playoffs: snapshotB.playoffs,
      leagues: snapshotB.total_standard_leagues,
    })
    const overallGradeA = scoreToGrade(overallScoreA)
    const overallGradeB = scoreToGrade(overallScoreB)

    const formatGrades: Record<string, { a: string; b: string; aScore: number; bScore: number }> = {}
    for (const type of ['redraft', 'dynasty', 'specialty'] as const) {
      const aStats = statsA.standard[type]
      const bStats = statsB.standard[type]
      const aScore = aStats && aStats.leagues > 0 ? computeFormatTypeScore(aStats) : 0
      const bScore = bStats && bStats.leagues > 0 ? computeFormatTypeScore(bStats) : 0
      formatGrades[type] = {
        a: aStats && aStats.leagues > 0 ? scoreToGrade(aScore) : 'N/A',
        b: bStats && bStats.leagues > 0 ? scoreToGrade(bScore) : 'N/A',
        aScore,
        bScore,
      }
    }

    // Winner/margin are scoped to ONLY the comparable formats (per the existing rule below),
    // not the full overall score, so a manager isn't credited/penalized for formats the
    // other doesn't play.
    const scopedScoreA = computeScopedScore(statsA.standard, comparableFormats)
    const scopedScoreB = computeScopedScore(statsB.standard, comparableFormats)
    const scoreDiff = scopedScoreA - scopedScoreB
    const deterministicWinner: 'A' | 'B' | 'TIE' | 'INCOMPARABLE' =
      comparableFormats.length === 0 ? 'INCOMPARABLE' : scoreDiff === 0 ? 'TIE' : scoreDiff > 0 ? 'A' : 'B'
    const deterministicMargin = comparableFormats.length === 0 ? 'INCOMPARABLE' : marginFromScoreDiff(scoreDiff)

    const userPrompt = `Compare these two fantasy managers FAIRLY:

## FORMAT OVERLAP ANALYSIS
Comparable formats (both managers have): ${comparableFormats.length > 0 ? comparableFormats.join(', ') : 'NONE - managers play different formats'}

Format breakdown:
- Redraft: Manager A has ${formatComparison.redraft?.a || 0} leagues, Manager B has ${formatComparison.redraft?.b || 0} leagues ${formatComparison.redraft?.a > 0 && formatComparison.redraft?.b > 0 ? '✓ COMPARABLE' : '✗ Not comparable'}
- Dynasty: Manager A has ${formatComparison.dynasty?.a || 0} leagues, Manager B has ${formatComparison.dynasty?.b || 0} leagues ${formatComparison.dynasty?.a > 0 && formatComparison.dynasty?.b > 0 ? '✓ COMPARABLE' : '✗ Not comparable'}
- Specialty: Manager A has ${formatComparison.specialty?.a || 0} leagues, Manager B has ${formatComparison.specialty?.b || 0} leagues ${formatComparison.specialty?.a > 0 && formatComparison.specialty?.b > 0 ? '✓ COMPARABLE' : '✗ Not comparable'}

MANAGER A: ${snapshotA.username}
${JSON.stringify(snapshotA, null, 2)}

MANAGER B: ${snapshotB.username}
${JSON.stringify(snapshotB, null, 2)}

## GRADES ARE ALREADY COMPUTED — DO NOT INVENT YOUR OWN
Every grade, winner, margin, and head-to-head result below is already computed deterministically
from the real stats above. Your JSON output MUST use these exact values for overall_grade,
grades_by_type.*.grade, winner, winner_username, margin, and head_to_head_breakdown — they will
be overwritten server-side regardless, so just echo them. Your real job is verdict, trash_talk,
strengths, and weaknesses — narrative that explains and is CONSISTENT with these given grades,
never contradicts them.

- Manager A overall grade: ${overallGradeA} (score ${overallScoreA.toFixed(1)})
- Manager B overall grade: ${overallGradeB} (score ${overallScoreB.toFixed(1)})
- Manager A redraft grade: ${formatGrades.redraft.a}, dynasty grade: ${formatGrades.dynasty.a}, specialty grade: ${formatGrades.specialty.a}
- Manager B redraft grade: ${formatGrades.redraft.b}, dynasty grade: ${formatGrades.dynasty.b}, specialty grade: ${formatGrades.specialty.b}
- Winner (comparable formats only): ${deterministicWinner === 'INCOMPARABLE' ? 'INCOMPARABLE' : deterministicWinner === 'TIE' ? 'TIE' : deterministicWinner}
- Margin: ${deterministicMargin}

IMPORTANT:
1. Only compare head-to-head in formats where BOTH managers participate
2. If a manager doesn't play a format, mark it "N/A" - don't penalize them
3. Overall winner MUST be based only on comparable formats
4. If no comparable formats exist, set winner to "INCOMPARABLE" and grade each manager individually`

    // Grades/winner/margin/head-to-head are fully deterministic (computed above) and don't
    // depend on the LLM at all — if the narrative call fails, still return the real grades
    // with a plain fallback narrative instead of failing the whole comparison. Matches the
    // existing deterministic-first + LLM-narrative-fallback pattern already used by Waiver AI.
    let comparison: any
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: COMPARE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      })

      const content = completion.choices[0]?.message?.content
      if (!content) throw new Error('AI did not return a response')
      comparison = JSON.parse(content)
    } catch (err) {
      console.error('Compare narrative generation failed, falling back to deterministic-only:', err)
      comparison = {
        manager_a: { username: snapshotA.username, strengths: [], weaknesses: [], specialty_formats_note: null },
        manager_b: { username: snapshotB.username, strengths: [], weaknesses: [], specialty_formats_note: null },
        verdict: 'AI narrative is temporarily unavailable — grades below are computed directly from real league history.',
        trash_talk: null,
      }
    }

    // Server-side validation to enforce fair comparison rules
    // If no comparable formats, override to INCOMPARABLE
    if (comparableFormats.length === 0) {
      comparison.winner = 'INCOMPARABLE'
      comparison.winner_username = 'N/A - Different Formats'
      comparison.margin = 'INCOMPARABLE'
      comparison.fair_comparison_possible = false
      comparison.comparable_formats = []
      // Ensure head-to-head are all N/A
      if (comparison.head_to_head_breakdown) {
        comparison.head_to_head_breakdown.redraft_winner = 'N/A'
        comparison.head_to_head_breakdown.dynasty_winner = 'N/A'
        comparison.head_to_head_breakdown.specialty_winner = 'N/A'
      }
    } else {
      // Ensure comparable_formats is set correctly
      comparison.comparable_formats = comparableFormats
      comparison.fair_comparison_possible = true
      comparison.winner = deterministicWinner
      comparison.winner_username = deterministicWinner === 'A' ? snapshotA.username : deterministicWinner === 'B' ? snapshotB.username : 'TIE'
      comparison.margin = deterministicMargin

      // Set head-to-head to the deterministic per-format comparison for comparable formats,
      // N/A for non-comparable ones.
      comparison.head_to_head_breakdown = comparison.head_to_head_breakdown || {}
      for (const type of ['redraft', 'dynasty', 'specialty'] as const) {
        const key = `${type}_winner` as const
        if (!comparableFormats.includes(type)) {
          comparison.head_to_head_breakdown[key] = 'N/A'
          continue
        }
        const diff = formatGrades[type].aScore - formatGrades[type].bScore
        comparison.head_to_head_breakdown[key] = diff === 0 ? 'TIE' : diff > 0 ? 'A' : 'B'
      }
    }

    // Deterministic grade backing — same real stats always produce the same grade, regardless
    // of what the LLM echoed back. This is the actual fix: previously overall_grade and
    // grades_by_type.*.grade were raw, unverified GPT-4o output with no code-side check.
    if (comparison.manager_a) {
      comparison.manager_a.overall_grade = overallGradeA
      comparison.manager_a.grades_by_type = comparison.manager_a.grades_by_type || {}
      for (const type of ['redraft', 'dynasty', 'specialty'] as const) {
        comparison.manager_a.grades_by_type[type] = comparison.manager_a.grades_by_type[type] || {}
        comparison.manager_a.grades_by_type[type].grade = formatGrades[type].a
      }
    }
    if (comparison.manager_b) {
      comparison.manager_b.overall_grade = overallGradeB
      comparison.manager_b.grades_by_type = comparison.manager_b.grades_by_type || {}
      for (const type of ['redraft', 'dynasty', 'specialty'] as const) {
        comparison.manager_b.grades_by_type[type] = comparison.manager_b.grades_by_type[type] || {}
        comparison.manager_b.grades_by_type[type].grade = formatGrades[type].b
      }
    }

    trackLegacyToolUsage('compare', null, null, { 
      usernameA: username_a, 
      usernameB: username_b,
      winner: comparison.winner,
    })

    return NextResponse.json({
      ok: true,
      comparison,
      snapshots: {
        a: snapshotA,
        b: snapshotB,
      },
      remaining: rl.remaining,
    })
  } catch (error: any) {
    console.error('Compare error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
})
