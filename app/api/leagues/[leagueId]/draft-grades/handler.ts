import { NextResponse } from "next/server"
import { computeDraftGrades, upsertDraftGrades, getDraftGrades } from "@/lib/rankings-engine/draft-grades"
import { withApiUsage } from "@/lib/telemetry/usage"
import { buildBaselineMeta, ensureArray } from "@/lib/engine/response-guard"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const GET = withApiUsage({
  endpoint: "/api/leagues/[leagueId]/draft-grades",
  tool: "DraftGrades"
})(async (req: Request, ctx: { params: { leagueId: string } }) => {
  try {
    const { leagueId } = ctx.params
    // Membership gate. Reachable both directly and via the [section]
    // dispatcher, and was open to anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
    const url = new URL(req.url)
    const season = String(url.searchParams?.get("season") ?? "")

    if (!leagueId || !season) {
      return NextResponse.json({ error: "Missing leagueId or season" }, { status: 400 })
    }

    const rows = await getDraftGrades({ leagueId, season })

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        leagueId,
        season,
        rows: [],
        meta: buildBaselineMeta(
          "post_draft_only",
          "Draft grades are only computed during post-draft phase."
        ),
      })
    }

    return NextResponse.json({ leagueId, season, rows: ensureArray(rows) })
  } catch (e) {
    console.error("[DraftGrades GET]", e instanceof Error ? e.message : e)
    return NextResponse.json({
      leagueId: ctx.params.leagueId,
      rows: [],
      meta: buildBaselineMeta("error", "Unable to load draft grades at this time."),
    })
  }
})

export const POST = withApiUsage({
  endpoint: "/api/leagues/[leagueId]/draft-grades",
  tool: "DraftGrades"
})(async (req: Request, ctx: { params: { leagueId: string } }) => {
  const { leagueId } = ctx.params
  // Membership gate. Reachable both directly and via the [section]
  // dispatcher, and was open to anyone holding a league id.
  const gate = await requireLeagueApiAccess(leagueId)
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => ({}))
  const week = Number(body.week ?? 0)

  if (!leagueId || !week) {
    return NextResponse.json({ error: "Missing leagueId or week" }, { status: 400 })
  }

  const computed = await computeDraftGrades({ leagueId, week })

  if (!computed.grades?.length) {
    return NextResponse.json(computed)
  }

  await upsertDraftGrades({
    leagueId,
    season: computed.season,
    grades: computed.grades.map((g: any) => ({
      rosterId: g.rosterId,
      grade: g.grade,
      score: g.score,
      breakdown: g.breakdown
    }))
  })

  return NextResponse.json({ ok: true, leagueId, season: computed.season, count: computed.grades.length })
})
