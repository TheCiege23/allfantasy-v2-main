import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'

export const runtime = "nodejs"

const openai = getOpenAIRouteClient()

const FEATURE_PROMPTS: Record<string, (ctx: any) => string> = {
  trade: (ctx) =>
    `You are an elite fantasy football AI analyst for AllFantasy. The user has a ${ctx.leagueType} league called "${ctx.leagueName}" with ${ctx.leagueSize} teams. Their team "${ctx.teamName}" is ranked #${ctx.rank} with a ${ctx.record} record.

Give a brief, punchy 2-3 sentence insight about what the AI Trade Analyzer can do for them RIGHT NOW based on their competitive position. Mention specific actionable value like "identify sell-high windows" or "find undervalued assets" based on their standing. Be specific, not generic.`,

  rivalry: (ctx) =>
    `You are an elite fantasy football AI analyst for AllFantasy. The user's team "${ctx.teamName}" is in a ${ctx.leagueSize}-team ${ctx.leagueType} league. They are ranked #${ctx.rank}.

Give a brief 2-3 sentence preview of what Rivalry Week Storylines would reveal for them — mention the kind of narratives (revenge games, heated matchups, trade tensions) that make fantasy more fun. Reference their competitive position.`,

  draft: (ctx) =>
    `You are an elite fantasy football AI analyst for AllFantasy. The user is in a ${ctx.leagueSize}-team ${ctx.leagueType} league called "${ctx.leagueName}".

Give a brief 2-3 sentence insight about what the Draft War Room offers — real-time recommendations, ADP intelligence, trade-up/down scenarios. Mention how it adapts to their specific league format and scoring.`,

  waiver: (ctx) =>
    `You are an elite fantasy football AI analyst for AllFantasy. The user's team "${ctx.teamName}" is ranked #${ctx.rank} with a ${ctx.record} record in a ${ctx.leagueType} league.

Give a brief 2-3 sentence preview of what the weekly "One Move" waiver plan would target for a team in their position. Be specific about the strategic approach (e.g., "streaming QBs" vs "stashing upside" vs "plugging bye-week holes") based on their rank.`,

  rankings: (ctx) =>
    `You are an elite fantasy football AI analyst for AllFantasy. The user's team "${ctx.teamName}" is ranked #${ctx.rank} in a ${ctx.leagueSize}-team league with a ${ctx.record} record.

Give a brief 2-3 sentence insight about what Power + Luck Rankings would reveal — whether they've been lucky or unlucky, how their points-for compares to their record, and what Monte Carlo projections suggest about their playoff odds.`,

  finder: (ctx) =>
    `You are an elite fantasy football AI analyst for AllFantasy. The user's team "${ctx.teamName}" is ranked #${ctx.rank} in a ${ctx.leagueSize}-team ${ctx.leagueType} league.

Give a brief 2-3 sentence preview of what the AI Trade Finder would surface — scanning all rosters for mutually beneficial deals. Mention the kind of trades a team at their ranking should be targeting (buying contender pieces vs selling for future value).`,
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const featureId = String(body?.featureId || "")
    const leagueId = String(body?.leagueId || "")

    if (!featureId) return NextResponse.json({ error: "featureId required" }, { status: 400 })

    const promptBuilder = FEATURE_PROMPTS[featureId]
    if (!promptBuilder) return NextResponse.json({ error: "Unknown feature" }, { status: 400 })

    let ctx: any = {
      leagueName: "Your League",
      leagueType: "redraft",
      leagueSize: 12,
      teamName: "Your Team",
      rank: "?",
      record: "?-?",
    }

    if (leagueId) {
      // Owned, or a league the caller holds a claimed team in (see the dashboard signals route).
      const league = await prisma.league.findFirst({
        where: {
          AND: [
            { OR: [{ id: leagueId }, { platformLeagueId: leagueId }] },
            { OR: [{ userId: session.user.id }, { teams: { some: { claimedByUserId: session.user.id } } }] },
          ],
        },
        include: {
          teams: { orderBy: { currentRank: "asc" }, take: 20 },
        },
      })

      if (league) {
        const userProfile = await prisma.userProfile.findUnique({ where: { userId: session.user.id } })
        const sleeperUsername = userProfile?.sleeperUsername || ""
        // The team the caller claimed first: a member of an imported league has no matching
        // owner name, and falling to `teams[0]` described someone else's team as theirs.
        const viewerId = session.user.id
        const userTeam =
          league.teams.find((t) => t.claimedByUserId === viewerId) ||
          league.teams.find((t) => t.ownerName?.toLowerCase() === sleeperUsername.toLowerCase()) ||
          league.teams[0]

        ctx = {
          leagueName: league.name || "Your League",
          leagueType: league.isDynasty ? "dynasty" : "redraft",
          leagueSize: league.leagueSize || league.teams.length || 12,
          teamName: userTeam?.teamName || userTeam?.ownerName || "Your Team",
          rank: userTeam?.currentRank || "?",
          record: userTeam
            ? `${userTeam.wins}-${userTeam.losses}${userTeam.ties ? `-${userTeam.ties}` : ""}`
            : "?-?",
        }
      }
    }

    const prompt = promptBuilder(ctx)

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a concise fantasy sports AI. Keep responses to 2-3 sentences max. Be specific and actionable. No bullet points. No headers. Just sharp insight." },
        { role: "user", content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.8,
    })

    const insight = completion.choices[0]?.message?.content?.trim() || "AI insight unavailable."

    return NextResponse.json({ ok: true, featureId, insight })
  } catch (err: any) {
    console.error("[ai-features] error", err)
    return NextResponse.json({ error: "Failed to generate insight" }, { status: 500 })
  }
}
