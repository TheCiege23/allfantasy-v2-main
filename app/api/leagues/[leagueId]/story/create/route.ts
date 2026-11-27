/**
 * POST /api/leagues/[leagueId]/story/create
 * Body: { storyType: StoryType, sport?: string, season?: number, style?: StoryStyle }
 * Returns created story (headline, sections, variants) and fact-guard warnings.
 *
 * 🛑 AF COMMISSIONER FOR THE WHOLE LEAGUE (owner, 2026-11-27). The story is written by models (DeepSeek, Grok,
 * OpenAI), so it runs only when the league's COMMISSIONER holds AF Commissioner or AF Supreme — then every
 * member may create one — and at most LEAGUE_STORY_AI_DAILY_LIMITS.league_story times a league a day
 * (lib/league-story-ai/leagueStoryAiGate.ts). A locked league gets the standard 403 paywall body, a capped one
 * a 429, both before any model call. This replaced the caller's own `storyline_creation` check with a token
 * fallback: a free commissioner's league is locked, whatever the caller holds, and nothing is charged.
 */
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { assertLeagueMember } from "@/lib/league-access"
import { createLeagueStory, getStoryVariant, storyToMediaShape } from "@/lib/league-story-creator"
import { normalizeToSupportedSport } from "@/lib/sport-scope"
import { checkLeagueStoryAiGate, leagueStoryAiRefusal } from "@/lib/league-story-ai/leagueStoryAiGate"
import type { StoryStyle, StoryType } from "@/lib/league-story-creator/types"

const STORY_TYPES: StoryType[] = [
  "weekly_recap",
  "rivalry",
  "upset",
  "playoff_bubble",
  "title_defense",
  "trade_fallout",
  "dynasty",
  "bracket_challenge",
  "platform_sport",
]

export const dynamic = "force-dynamic"
const STORY_STYLES: StoryStyle[] = ["announcer", "recap", "neutral"]

export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as
      | { user?: { id?: string; email?: string | null } }
      | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })
    let access: { leagueSport: string }
    try {
      access = await assertLeagueMember(leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // A bad request costs nothing: validated before the gate counts a call against the league's cap.
    const body = await req.json().catch(() => ({}))
    const storyType = body.storyType as string
    if (!storyType || !STORY_TYPES.includes(storyType as StoryType)) {
      return NextResponse.json(
        { error: "Invalid or missing storyType. Use one of: " + STORY_TYPES.join(", ") },
        { status: 400 }
      )
    }

    const aiGate = await checkLeagueStoryAiGate({ leagueId, kind: "league_story", lang: body.lang })
    if (!aiGate.ok) return leagueStoryAiRefusal(aiGate)

    const sport = normalizeToSupportedSport(body.sport ?? access.leagueSport ?? "NFL")
    const season = body.season != null ? Number(body.season) : null
    const style = STORY_STYLES.includes(body.style as StoryStyle)
      ? (body.style as StoryStyle)
      : "neutral"

    const result = await createLeagueStory({
      leagueId,
      sport,
      season,
      storyType: storyType as StoryType,
      style,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Failed to create story" },
        { status: 500 }
      )
    }

    const variants = result.story
      ? {
          short: getStoryVariant(result.story, "short"),
          social: getStoryVariant(result.story, "social"),
          long: getStoryVariant(result.story, "long"),
        }
      : null
    const media =
      result.story != null
        ? storyToMediaShape(result.story, {
            leagueId,
            sport,
            storyType: storyType as StoryType,
          })
        : null

    return NextResponse.json({
      leagueId,
      storyType,
      sport,
      season,
      style,
      story: result.story,
      sections: result.sections,
      variants,
      media,
      factGuardWarnings: result.factGuardWarnings ?? [],
      factGuardErrors: result.factGuardErrors ?? [],
      oneBrainMerge: {
        deterministic: "context_assembler",
        deepseek: "significance",
        grok: "narrative_framing",
        openai: "final_user_story",
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error("[story/create POST]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create story" },
      { status: 500 }
    )
  }
}
