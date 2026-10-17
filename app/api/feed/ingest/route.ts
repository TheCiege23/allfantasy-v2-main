import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import {
  evaluateBracketsBustedEvents,
  type GameFinalContext,
  type LeagueImpactContext,
  type SpamControl,
  DEFAULT_SPAM,
} from "@/lib/feed/bustedRules"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  // Worker endpoint: it writes tournaments, nodes, picks or feed events, so it
  // takes the same cron/admin secret as sync-playoff. It was reachable anonymously.
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const body = await req.json()
    const { game, impact, spam } = body as {
      game: GameFinalContext
      impact: LeagueImpactContext
      spam?: Partial<SpamControl>
    }

    if (!game?.tournamentId || !game?.gameId || !game?.round) {
      return NextResponse.json(
        { error: "game.tournamentId, game.gameId, and game.round are required" },
        { status: 400 }
      )
    }

    if (typeof impact?.totalBrackets !== "number" || typeof impact?.favoritePickPct !== "number") {
      return NextResponse.json(
        { error: "impact.totalBrackets and impact.favoritePickPct are required" },
        { status: 400 }
      )
    }

    const existing = await (prisma as any).bracketFeedEvent.findFirst({
      where: {
        tournamentId: game.tournamentId,
        metadata: { path: ["gameId"], equals: game.gameId },
        ...(impact.leagueId ? { leagueId: impact.leagueId } : { leagueId: null }),
      },
    })

    if (existing) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Event already exists for this game + scope",
        eventId: existing.id,
      })
    }

    const mergedSpam: SpamControl = { ...DEFAULT_SPAM, ...(spam ?? {}) }
    const drafts = evaluateBracketsBustedEvents(game, impact, mergedSpam)

    if (drafts.length === 0) {
      return NextResponse.json({
        ok: true,
        created: 0,
        reason: "No events passed threshold rules",
      })
    }

    const created = await Promise.all(
      drafts.map((draft) =>
        (prisma as any).bracketFeedEvent.create({
          data: {
            tournamentId: game.tournamentId,
            leagueId: impact.leagueId ?? null,
            eventType: draft.type,
            headline: draft.title,
            detail: draft.message,
            metadata: {
              gameId: draft.gameId ?? game.gameId,
              impactPct: draft.impactPct ?? null,
              round: game.round,
              seedWinner: game.seedWinner,
              seedLoser: game.seedLoser,
              underdogWon: game.underdogWon,
              scope: impact.scope,
            },
          },
        })
      )
    )

    return NextResponse.json({
      ok: true,
      created: created.length,
      events: created.map((e: any) => ({
        id: e.id,
        type: e.eventType,
        headline: e.headline,
      })),
    })
  } catch (err: any) {
    console.error("[api/feed/ingest] Error:", err)
    return NextResponse.json(
      { error: err.message || "Failed to ingest event" },
      { status: 500 }
    )
  }
}
