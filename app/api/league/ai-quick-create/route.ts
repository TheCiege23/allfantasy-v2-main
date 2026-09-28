import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { upgradePathForPlan } from '@/lib/monetization/upgradeDestination'
import { resolveLivePlanFlags } from '@/lib/subscription/livePlanFlags'
import { DEFAULT_SPORT, SUPPORTED_SPORTS } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

const VALID_SPORTS: readonly string[] = SUPPORTED_SPORTS
const VALID_LEAGUE_TYPES = ['redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine', 'survivor', 'tournament', 'zombie', 'salary_cap', 'devy', 'c2c']
const VALID_DRAFT_TYPES = ['snake', 'linear', 'auction', 'slow_draft']

/**
 * AI Quick Create — Chimmy parses a natural language description
 * and returns league configuration settings.
 *
 * Gated behind AF Commissioner Subscription.
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The live plan, not the profile flag (lib/subscription/livePlanFlags.ts).
  const plans = await resolveLivePlanFlags(session.user.id, session.user.email)
  if (!plans.commissioner) {
    return NextResponse.json(
      {
        error: 'AF Commissioner subscription required',
        upgradePath: upgradePathForPlan('af_commissioner', { feature: 'ai_quick_create' }),
      },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { prompt?: string }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt || prompt.length < 5) {
    return NextResponse.json({ error: 'Please describe your league (at least 5 characters)' }, { status: 400 })
  }

  // Parse the prompt deterministically first (no AI needed for clear inputs)
  const result = parseLeaguePrompt(prompt)

  return NextResponse.json({ result })
}

/**
 * Deterministic parser — extracts league settings from natural language.
 * No LLM call needed for most inputs. Faster and cheaper.
 */
function parseLeaguePrompt(prompt: string): {
  sport: string
  leagueType: string
  draftType: string
  teamCount: number
  leagueName: string
  scoringFormat: string
  explanation: string
} {
  const lower = prompt.toLowerCase()

  // Detect sport — college / NCAAB before NBA so phrases like "NCAA basketball" are not classified as NBA.
  let sport = 'NFL'
  if (lower.includes('college football') || lower.includes('ncaaf') || lower.includes('cfb')) sport = 'NCAAF'
  else if (
    lower.includes('college basketball') ||
    lower.includes('ncaab') ||
    lower.includes('cbb') ||
    lower.includes('ncaa basketball') ||
    lower.includes("ncaa women's basketball") ||
    lower.includes('march madness')
  )
    sport = 'NCAAB'
  else if (lower.includes('mlb') || lower.includes('baseball')) sport = 'MLB'
  else if (lower.includes('nhl') || lower.includes('hockey')) sport = 'NHL'
  else if (
    lower.includes('nba') ||
    (lower.includes('basketball') && !lower.includes('ncaa') && !lower.includes('college'))
  )
    sport = 'NBA'
  else if (lower.includes('soccer') || lower.includes('premier league') || lower.includes('epl') || lower.includes('futbol')) sport = 'SOCCER'

  // Detect league type
  let leagueType = 'redraft'
  if (lower.includes('dynasty')) leagueType = 'dynasty'
  else if (lower.includes('keeper')) leagueType = 'keeper'
  else if (lower.includes('best ball') || lower.includes('bestball')) leagueType = 'best_ball'
  else if (lower.includes('guillotine')) leagueType = 'guillotine'
  else if (lower.includes('survivor')) leagueType = 'survivor'
  else if (lower.includes('tournament')) leagueType = 'tournament'
  else if (lower.includes('zombie')) leagueType = 'zombie'
  else if (lower.includes('salary cap') || lower.includes('contract')) leagueType = 'salary_cap'
  else if (lower.includes('devy')) leagueType = 'devy'
  else if (lower.includes('c2c') || lower.includes('campus to canton') || lower.includes('campus 2 canton')) leagueType = 'c2c'
  else if (lower.includes('big brother')) leagueType = 'survivor' // closest match
  else if (lower.includes('idp')) leagueType = 'redraft' // IDP is a modifier, not a type

  // Detect draft type
  let draftType = 'snake'
  if (lower.includes('auction')) draftType = 'auction'
  else if (lower.includes('linear')) draftType = 'linear'
  else if (lower.includes('slow draft') || lower.includes('slow-draft')) draftType = 'slow_draft'

  // Validate parsed values against allowed sets before returning.
  if (!VALID_SPORTS.includes(sport)) sport = DEFAULT_SPORT
  if (!VALID_LEAGUE_TYPES.includes(leagueType)) leagueType = 'redraft'
  if (!VALID_DRAFT_TYPES.includes(draftType)) draftType = 'snake'

  // Detect team count
  let teamCount = 12
  const teamMatch = lower.match(/(\d+)\s*(?:team|man|manager|player|people|member)/)
  if (teamMatch) {
    const parsed = parseInt(teamMatch[1], 10)
    if (parsed >= 4 && parsed <= 32) teamCount = parsed
  }

  // Detect scoring
  let scoringFormat = 'ppr'
  if (lower.includes('half ppr') || lower.includes('half-ppr') || lower.includes('.5 ppr')) scoringFormat = 'half_ppr'
  else if (lower.includes('standard') && !lower.includes('ppr')) scoringFormat = 'standard'
  else if (lower.includes('points') && (sport === 'NBA' || sport === 'NHL')) scoringFormat = 'points'
  else if (lower.includes('categories') || lower.includes('9cat') || lower.includes('roto')) scoringFormat = 'categories'

  // Detect modifiers
  const modifiers: string[] = []
  if (lower.includes('superflex') || /\bsf\b/.test(lower) || lower.includes('2qb')) modifiers.push('superflex')
  if (lower.includes('idp')) modifiers.push('IDP')
  if (lower.includes('te premium') || lower.includes('tep')) modifiers.push('TE premium')

  // Generate a league name
  const typeLabel = leagueType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const leagueName = `${sport} ${typeLabel} League`

  // Build explanation
  const parts = [
    `${teamCount}-team ${sport} ${typeLabel} league`,
    `${draftType.replace(/_/g, ' ')} draft`,
    `${scoringFormat.replace(/_/g, ' ').toUpperCase()} scoring`,
  ]
  if (modifiers.length > 0) parts.push(modifiers.join(' + '))
  const explanation = `Chimmy recommends: ${parts.join(', ')}. You can customize any setting in the wizard.`

  return {
    sport,
    leagueType,
    draftType,
    teamCount,
    leagueName,
    scoringFormat,
    explanation,
  }
}
