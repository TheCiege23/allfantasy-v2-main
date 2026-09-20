import { NextResponse } from "next/server"
import { z } from "zod"
import { createPlayoffBracketChallenge, listUserPlayoffChallenges } from "@/lib/playoffs/playoffService"
import type { PlayoffSport } from "@/lib/playoffs/types"
import { requireWorldCupApiUser } from "./_utils"

export const runtime = "nodejs"

/**
 * MLB is accepted here because the four things it needed now exist and are
 * each verified, which is the bar this gate was holding:
 *
 *   1. a seeding source — `/api/cron/import-standings` ingests MLB, and ESPN
 *      supplies `playoffSeed`, which applies the real division-winner rule;
 *   2. a scheduled writer — the results phase on the playoff cron;
 *   3. round and league inference checked against ESPN's REAL 2025 postseason
 *      rather than guessed (the guessed patterns were wrong twice); and
 *   4. a finality guard, so seeding cannot write a provisional field.
 *
 * ⚠ A POOL CREATED BEFORE THE FIELD IS SET IS FINE, AND THAT IS BY DESIGN.
 * Its slots read `AL1`…`NL6` and are pickable as seeds; when the regular
 * season ends, seeding fills them with real clubs and rewrites every pick that
 * named a seed, in one transaction. So an entrant who called "AL3 over AL6" in
 * September still holds that call in October, against the clubs that turned
 * out to be AL3 and AL6.
 */
const createPlayoffChallengeSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  sport: z.enum(["nba", "nhl", "mlb"]),
  seasonYear: z.coerce.number().int().min(2024).max(2100).optional(),
  isTestMode: z.boolean().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  maxUsers: z.coerce.number().int().min(2).max(500).optional(),
  bracketsPerUser: z.coerce.number().int().min(1).max(10).optional(),
  scoringStyle: z.string().trim().min(1).max(60).optional(),
  lockRule: z.string().trim().min(1).max(60).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

function isMissingColumnError(error: unknown, columnNames: string[]): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const code = typeof error === "object" && error ? String((error as any).code ?? "") : ""
  return (
    code === "P2022" ||
    columnNames.some((column) => message.includes(column)) ||
    message.includes("Unknown arg") ||
    message.includes("Unknown field")
  )
}

function createErrorResponse(input: {
  code: string
  message: string
  details?: Record<string, unknown>
  status?: number
}) {
  return NextResponse.json(
    {
      ok: false,
      error: input.code,
      code: input.code,
      message: input.message,
      details: input.details ?? null,
    },
    { status: input.status ?? 500 },
  )
}

export async function GET(request: Request) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const sportParam = searchParams.get("sport")
  const sport =
    sportParam === "nba" || sportParam === "nhl" || sportParam === "mlb" ? sportParam : null

  try {
    const challenges = await listUserPlayoffChallenges(auth.user.id)
    return NextResponse.json({
      ok: true,
      challenges: sport ? challenges.filter((challenge) => challenge.sport === sport) : challenges,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load playoff challenges",
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => ({}))
  const parsed = createPlayoffChallengeSchema.safeParse(body)
  if (!parsed.success) {
    return createErrorResponse({
      code: "INVALID_PLAYOFF_CREATE_REQUEST",
      message: "Create pool settings are invalid. Please review the form and try again.",
      details: { issues: parsed.error.flatten() },
      status: 400,
    })
  }

  try {
    const config = {
      ...(parsed.data.config ?? {}),
      ...(parsed.data.visibility ? { visibility: parsed.data.visibility } : {}),
      ...(parsed.data.maxUsers ? { maxParticipants: parsed.data.maxUsers } : {}),
      ...(parsed.data.bracketsPerUser ? { maxEntriesPerParticipant: parsed.data.bracketsPerUser } : {}),
      ...(parsed.data.scoringStyle ? { scoringStyle: parsed.data.scoringStyle } : {}),
      ...(parsed.data.lockRule ? { lockRule: parsed.data.lockRule } : {}),
    }
    const result = await createPlayoffBracketChallenge({
      user: auth.user,
      name: parsed.data.name,
      sport: parsed.data.sport,
      seasonYear: parsed.data.seasonYear,
      isTestMode: parsed.data.isTestMode,
      config,
    })

    return NextResponse.json({
      ok: true,
      challengeId: result.challengeId,
      entryId: result.entryId,
      sport: result.sport as PlayoffSport,
      name: result.name,
      redirectUrl: result.redirectUrl,
    })
  } catch (error) {
    if (isMissingColumnError(error, ["config"])) {
      try {
        const result = await createPlayoffBracketChallenge({
          user: auth.user,
          name: parsed.data.name,
          sport: parsed.data.sport,
          seasonYear: parsed.data.seasonYear,
          isTestMode: parsed.data.isTestMode,
          config: null,
          options: { includeConfig: false },
        })
        return NextResponse.json({
          ok: true,
          challengeId: result.challengeId,
          entryId: result.entryId,
          sport: result.sport as PlayoffSport,
          name: result.name,
          redirectUrl: result.redirectUrl,
          warning: {
            code: "PLAYOFF_CONFIG_MIGRATION_PENDING",
            message: "Pool created with standard settings. Advanced settings will be available after the latest database migration finishes.",
          },
        })
      } catch (fallbackError) {
        if (isMissingColumnError(fallbackError, ["home_team_wins", "away_team_wins", "series_summary", "provider_games_json"])) {
          try {
            const result = await createPlayoffBracketChallenge({
              user: auth.user,
              name: parsed.data.name,
              sport: parsed.data.sport,
              seasonYear: parsed.data.seasonYear,
              isTestMode: parsed.data.isTestMode,
              config: null,
              options: { includeConfig: false, includeSeriesProviderMetadata: false },
            })
            return NextResponse.json({
              ok: true,
              challengeId: result.challengeId,
              entryId: result.entryId,
              sport: result.sport as PlayoffSport,
              name: result.name,
              redirectUrl: result.redirectUrl,
              warning: {
                code: "PLAYOFF_SERIES_METADATA_MIGRATION_PENDING",
                message: "Pool created with standard settings. Series details will appear after the latest database migration finishes.",
              },
            })
          } catch (finalError) {
            return createErrorResponse({
              code: "PLAYOFF_CREATE_FAILED",
              message: "Playoff pool creation failed. Please try again after the latest database migration finishes.",
              details: { reason: finalError instanceof Error ? finalError.message : "Unknown create failure" },
            })
          }
        }
        return createErrorResponse({
          code: "PLAYOFF_CREATE_FAILED",
          message: "Playoff pool creation failed. Please try again.",
          details: { reason: fallbackError instanceof Error ? fallbackError.message : "Unknown create failure" },
        })
      }
    }

    if (isMissingColumnError(error, ["home_team_wins", "away_team_wins", "series_summary", "provider_games_json"])) {
      return createErrorResponse({
        code: "PLAYOFF_SERIES_METADATA_MIGRATION_PENDING",
        message: "Playoff pool creation needs the latest series metadata database migration before it can complete.",
      })
    }

    return createErrorResponse({
      code: "PLAYOFF_CREATE_FAILED",
      message: "Playoff pool creation failed. Please try again.",
      details: { reason: error instanceof Error ? error.message : "Unknown create failure" },
    })
  }
}
