import { NextResponse } from "next/server"
import { getEntryByIdScoped } from "@/lib/hall-of-fame-engine/HallOfFameQueryService"
import { entryToNarrativeContext, buildWhyInductedPromptContext } from "@/lib/hall-of-fame-engine/AIHallOfFameNarrativeAdapter"
import { getHallOfFameEntryWithLegacy } from "@/lib/prestige-governance/HallOfFameLegacyBridge"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string; entryId: string }> }
) {
  try {
    const { leagueId, entryId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
    if (!entryId) return NextResponse.json({ error: "Missing entryId" }, { status: 400 })

    const entry = await getEntryByIdScoped({ entryId, leagueId })
    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    const enriched = await getHallOfFameEntryWithLegacy({ entryId, leagueId }).catch(() => null)

    const narrativeContext = entryToNarrativeContext(entry)
    const whyInductedPrompt = buildWhyInductedPromptContext(narrativeContext)

    return NextResponse.json({
      entry: {
        id: entry.id,
        entityType: entry.entityType,
        entityId: entry.entityId,
        sport: entry.sport,
        leagueId: entry.leagueId,
        season: entry.season,
        category: entry.category,
        title: entry.title,
        summary: entry.summary,
        inductedAt: entry.inductedAt.toISOString(),
        score: entry.score,
        metadata: entry.metadata,
        legacy:
          enriched?.legacy != null
            ? {
                id: enriched.legacy.id,
                entityType: enriched.legacy.entityType,
                entityId: enriched.legacy.entityId,
                sport: enriched.legacy.sport,
                leagueId: enriched.legacy.leagueId,
                overallLegacyScore: enriched.legacy.overallLegacyScore,
                championshipScore: enriched.legacy.championshipScore,
                playoffScore: enriched.legacy.playoffScore,
                consistencyScore: enriched.legacy.consistencyScore,
                rivalryScore: enriched.legacy.rivalryScore,
                awardsScore: enriched.legacy.awardsScore,
                dynastyScore: enriched.legacy.dynastyScore,
                updatedAt: enriched.legacy.updatedAt.toISOString(),
              }
            : null,
      },
      narrativeContext,
      whyInductedPrompt,
    })
  } catch (e) {
    console.error("[HallOfFame entry GET]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Unable to load Hall of Fame entry." },
      { status: 500 }
    )
  }
}
