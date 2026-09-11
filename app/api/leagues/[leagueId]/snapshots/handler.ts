import { NextResponse } from "next/server"
import { saveRankingsSnapshot } from "@/lib/rankings-engine/snapshots"
import { getV2Rankings, RankingsUnavailableError } from "@/lib/rankings-engine/v2-adapter"
import { withApiUsage } from "@/lib/telemetry/usage"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const POST = withApiUsage({
  endpoint: "/api/leagues/[leagueId]/snapshots",
  tool: "Snapshots"
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

  try {
    const v2 = await getV2Rankings({ leagueId, week })

    await saveRankingsSnapshot({
      leagueId,
      season: v2.season,
      week: v2.week,
      teams: v2.teams.map((t: any) => ({
        rosterId: t.rosterId,
        rank: t.rank,
        composite: Number(t.composite ?? 0),
        expectedWins: t.expectedWins ?? null,
        luckDelta: t.luckDelta ?? null,
        metricsJson: t._snapshotMetrics ?? null,
      }))
    })

    /*
     * `teams` is reported because `saveRankingsSnapshot` runs
     * `prisma.$transaction(args.teams.map(...))` — an empty array is a no-op transaction that
     * resolves successfully having written nothing. Without this count, "ok: true" is returned
     * just as cheerfully for zero rows as for twelve.
     */
    return NextResponse.json({ ok: true, season: v2.season, week: v2.week, teams: v2.teams.length })
  } catch (err: any) {
    /*
     * A league whose settings will not load is a NORMAL single-league outcome — a deleted league,
     * a renumbered id, a provider timeout — not a server fault. It was previously indistinguishable
     * from a real failure: the null flowed through the cast, `v2.season` threw a TypeError, and
     * this branch reported "Failed to save snapshot" with a 500. A batch caller could not tell
     * "skip this league" from "something is broken, stop".
     */
    if (err instanceof RankingsUnavailableError) {
      console.warn("[Snapshots API] rankings unavailable", { leagueId: err.leagueId, week: err.week })
      return NextResponse.json(
        { error: "Rankings unavailable for this league and week", leagueId: err.leagueId, week: err.week },
        { status: 422 },
      )
    }
    console.error("[Snapshots API]", err?.message)
    return NextResponse.json({ error: "Failed to save snapshot" }, { status: 500 })
  }
})
