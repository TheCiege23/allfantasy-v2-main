import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { openaiChatJson } from '@/lib/openai-client'
import { maxRegularSeasonWeeksForSport, regularSeasonCapApplies } from '@/lib/redraft/regularSeasonCap'
import { isSurvivorCreationSportAvailable, SURVIVOR_CREATION_UNAVAILABLE_MESSAGE } from '@/lib/survivor/survivorCreationAvailability'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `You are an expert fantasy sports league commissioner AI. Given a user's preferences described in natural language, generate complete league creation settings as JSON.

Return ONLY valid JSON with these fields:
{
  "name": "string (creative league name)",
  "sport": "NFL" | "NBA" | "MLB" | "NHL" | "NCAAF" | "NCAAB" | "SOCCER",
  "leagueType": "redraft" | "dynasty" | "keeper" | "best_ball" | "guillotine" | "survivor" | "tournament" | "zombie" | "salary_cap" | "big_brother",
  "draftType": "snake" | "linear" | "auction" | "slow_draft",
  "teamCount": number (4-32),
  "scoring": "PPR" | "HALF_PPR" | "STANDARD" | "SUPERFLEX" | "IDP",
  "isDynasty": boolean,
  "isSuperflex": boolean,
  "tradeReviewMode": "commissioner" | "league_vote" | "none",
  "waiverType": "faab" | "rolling" | "reverse_standings",
  "playoffTeams": number (4-8),
  "regularSeasonWeeks": number (at most 24),
  "summary": "string (2-3 sentence summary of the league setup for the user)"
}

Infer reasonable defaults for anything not specified. Be creative with the league name based on the theme.`

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { preferences } = body as { preferences?: string }

  if (!preferences?.trim()) {
    return NextResponse.json({ error: 'Please describe your league preferences' }, { status: 400 })
  }

  try {
    const result = await openaiChatJson({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: preferences },
      ],
      temperature: 0.7,
      maxTokens: 800,
      skipCache: true,
    })

    if (!result.ok) {
      return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
    }

    const raw = result.json
    const content = raw?.choices?.[0]?.message?.content ?? raw?.content ?? ''
    let settings: Record<string, unknown> = {}

    try {
      settings = typeof content === 'string' ? JSON.parse(content) : content
    } catch {
      // Try to extract JSON from the response
      const match = String(content).match(/\{[\s\S]*\}/)
      if (match) {
        settings = JSON.parse(match[0])
      } else {
        return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 502 })
      }
    }

    if (String(settings.leagueType ?? '').toLowerCase() === 'survivor' &&
        !isSurvivorCreationSportAvailable(String(settings.sport ?? ''))) {
      return NextResponse.json({ error: SURVIVOR_CREATION_UNAVAILABLE_MESSAGE }, { status: 400 })
    }

    // A redraft or keeper regular season is at most 24 weeks (lib/redraft/regularSeasonCap.ts).
    const suggestedWeeks = Number(settings.regularSeasonWeeks)
    const maxRegularWeeks = maxRegularSeasonWeeksForSport(settings.sport)
    if (
      Number.isFinite(suggestedWeeks) && suggestedWeeks > maxRegularWeeks &&
      regularSeasonCapApplies({ leagueType: String(settings.leagueType ?? 'redraft'), sport: settings.sport })
    ) {
      settings.regularSeasonWeeks = maxRegularWeeks
    }

    return NextResponse.json({ ok: true, settings })
  } catch (e) {
    console.error('[quick-create]', e)
    return NextResponse.json({ error: 'Quick create failed' }, { status: 500 })
  }
}
