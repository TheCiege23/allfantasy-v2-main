import { NextResponse } from "next/server"
import { getMomentByIdScoped } from "@/lib/hall-of-fame-engine/HallOfFameQueryService"
import { momentToNarrativeContext, buildWhyInductedPromptContext } from "@/lib/hall-of-fame-engine/AIHallOfFameNarrativeAdapter"
import { getHallOfFameMomentWithLegacy } from "@/lib/prestige-governance/HallOfFameLegacyBridge"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string; momentId: string }> }
) {
  try {
    const { leagueId, momentId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
    if (!momentId) return NextResponse.json({ error: "Missing momentId" }, { status: 400 })

    const moment = await getMomentByIdScoped({ momentId, leagueId })
    if (!moment) return NextResponse.json({ error: "Moment not found" }, { status: 404 })
    const enriched = await getHallOfFameMomentWithLegacy({ momentId, leagueId }).catch(() => null)

    const narrativeContext = momentToNarrativeContext(moment)
    const whyInductedPrompt = buildWhyInductedPromptContext(narrativeContext)

    return NextResponse.json({
      moment: {
        id: moment.id,
        leagueId: moment.leagueId,
        sport: moment.sport,
        season: moment.season,
        headline: moment.headline,
        summary: moment.summary,
        relatedManagerIds: moment.relatedManagerIds,
        relatedTeamIds: moment.relatedTeamIds,
        relatedMatchupId: moment.relatedMatchupId,
        significanceScore: moment.significanceScore,
        createdAt: moment.createdAt.toISOString(),
        relatedLegacy: enriched
          ? Object.fromEntries(
              [...enriched.relatedLegacy.entries()].map(([managerId, row]) => [
                managerId,
                {
                  id: row.id,
                  entityType: row.entityType,
                  entityId: row.entityId,
                  sport: row.sport,
                  leagueId: row.leagueId,
                  overallLegacyScore: row.overallLegacyScore,
                  championshipScore: row.championshipScore,
                  playoffScore: row.playoffScore,
                  consistencyScore: row.consistencyScore,
                  rivalryScore: row.rivalryScore,
                  awardsScore: row.awardsScore,
                  dynastyScore: row.dynastyScore,
                  updatedAt: row.updatedAt.toISOString(),
                },
              ])
            )
          : {},
      },
      narrativeContext,
      whyInductedPrompt,
    })
  } catch (e) {
    console.error("[HallOfFame moment GET]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Unable to load Hall of Fame moment." },
      { status: 500 }
    )
  }
}
