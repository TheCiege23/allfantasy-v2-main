import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { z } from "zod";
import { LeagueSport, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth-guard";
import {
  upsertPlatformIdentity,
  isPlatformRankLocked,
  lockPlatformRank,
  PlatformIdentityConflictError,
} from "@/lib/platform-identity";
import { computeAndSaveRank } from "@/lib/ranking/computeAndSaveRank";
import { calculateAndSaveRank } from "@/lib/rank/calculateRank";
import { refreshUserRankingsContext } from "@/lib/rankings/refreshUserContext";
import { syncLeagueHistory } from "@/lib/league/syncLeagueHistory";
import { upsertSleeperRankingImportLeague } from "@/lib/league/sleeper-ranking-import";
import {
  processLeague,
  getSleeperAvatarUrl,
  getErrorMessage,
  sumCommentaryTelemetry,
  type SleeperLeague,
  type MatchupCommentaryTelemetry,
} from "@/lib/league/sleeper-import-process";
import { getUserLeagues, getSleeperUser } from "@/lib/sleeper-client";
import {
  consumeRateLimit,
  getClientIp,
  buildRateLimit429,
} from "@/lib/rate-limit";
import { consumeDailyLimit } from "@/lib/rate-limit-daily";

/**
 * Sleeper league import — **AllFantasy `userId` (session) is canonical**.
 * `sleeperUserId` from Sleeper is stored only to route Sleeper API calls and imports; it is not the primary user key on AF.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURRENT_IMPORT_SEASON = new Date().getFullYear();

const leagueImportLimit = pLimit(8);

const bodySchema = z
  .object({
    /** Sleeper `user_id` or username (API `/user/:id` accepts both). Provider identifier only — AF account is `session.user.id`. */
    sleeperUserId: z.string().min(1).max(100).optional(),
    /** Alias for older clients (e.g. `{ username, platform }`). Same resolution as `sleeperUserId`. */
    username: z.string().min(1).max(100).optional(),
    sport: z.enum(["nfl", "nba", "mlb", "nhl", "mls"]).default("nfl"),
    season: z.number().int().min(2020).max(2035).default(CURRENT_IMPORT_SEASON),
    isLegacy: z.boolean().default(false),
  })
  .refine((d) => Boolean(d.sleeperUserId?.trim() || d.username?.trim()), {
    message: "sleeperUserId or username is required",
    path: ["sleeperUserId"],
  });

const sportMap: Record<"nfl" | "nba" | "mlb" | "nhl" | "mls", LeagueSport> = {
  nfl: LeagueSport.NFL,
  nba: LeagueSport.NBA,
  mlb: LeagueSport.MLB,
  nhl: LeagueSport.NHL,
  mls: LeagueSport.SOCCER,
};

export async function POST(req: Request) {
  try {
    const auth = await requireVerifiedUser();
    if (!auth.ok) {
      return auth.response;
    }
    const afUserId = auth.userId;

    const ip = getClientIp(req);

    const rl = consumeRateLimit({
      scope: "import",
      action: "sleeper_sync",
      sleeperUsername: afUserId,
      ip,
      maxRequests: 5,
      windowMs: 60 * 1000,
      includeIpInKey: true,
    });

    if (!rl.success) {
      return NextResponse.json(buildRateLimit429({ rl }), { status: 429 });
    }

    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { sport, season, isLegacy } = parsed.data;
    const rawIdentifier = (parsed.data.sleeperUserId ?? parsed.data.username ?? "").trim();
    const sportLabel = sportMap[sport];

    const sleeperUser = await getSleeperUser(rawIdentifier);
    if (!sleeperUser?.user_id) {
      return NextResponse.json({ error: "Sleeper user not found" }, { status: 404 });
    }
    const sleeperUserId = sleeperUser.user_id;
    const sleeperUsernameResolved = sleeperUser.username?.trim() || rawIdentifier;

    const dailyImport = await consumeDailyLimit({
      provider: "sleeper",
      endpoint: `${isLegacy ? "ranking-import" : "league-import"}:${sleeperUserId}:${sport}:${season}`,
    });
    if (!dailyImport.success) {
      return NextResponse.json(
        {
          error: isLegacy
            ? "Ranking import is limited to once per day for this Sleeper account, sport, and season."
            : "League import is limited to once per day for this Sleeper account, sport, and season.",
          retryAfterSec: dailyImport.retryAfterSec,
        },
        { status: 429 }
      );
    }

    try {
      await prisma.userProfile.upsert({
        where: { userId: afUserId },
        update: {
          sleeperUserId,
          sleeperUsername: sleeperUsernameResolved,
          sleeperLinkedAt: new Date(),
        },
        create: {
          userId: afUserId,
          sleeperUserId,
          sleeperUsername: sleeperUsernameResolved,
          sleeperLinkedAt: new Date(),
        },
      })
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return NextResponse.json(
          {
            error:
              "That Sleeper profile is already linked to another AllFantasy account. Sign in with the account that owns it, or use a different Sleeper user.",
          },
          { status: 409 }
        );
      }
      console.error("[import-sleeper] userProfile sleeper link failed:", e);
      return NextResponse.json({ error: "Could not save Sleeper link to your profile." }, { status: 500 });
    }

    try {
      await upsertPlatformIdentity({
        afUserId,
        platform: "sleeper",
        platformUserId: sleeperUser.user_id,
        platformUsername: sleeperUsernameResolved,
        displayName: sleeperUser.display_name?.trim() || sleeperUsernameResolved,
        avatarUrl: getSleeperAvatarUrl(sleeperUser.avatar) ?? undefined,
        sport,
      });
    } catch (e: unknown) {
      if (e instanceof PlatformIdentityConflictError) {
        return NextResponse.json(
          {
            error:
              "That Sleeper profile is already linked to another AllFantasy account. Sign in with the account that owns it, or use a different Sleeper user.",
          },
          { status: 409 }
        );
      }
      throw e;
    }

    const leaguesData = await getUserLeagues(sleeperUserId, sport, String(season)).catch(() => null) as unknown as SleeperLeague[] | null;

    if (!Array.isArray(leaguesData) || leaguesData.length === 0) {
      return NextResponse.json(
        { error: "No leagues found for this user" },
        { status: 404 }
      );
    }

    const results = await Promise.all(
      leaguesData.map((leagueData) =>
        leagueImportLimit(async () => {
          try {
            if (isLegacy) {
              const row = await upsertSleeperRankingImportLeague(
                leagueData,
                afUserId,
                season,
                sportLabel,
                sleeperUserId
              );
              if (!row) return null;
              return {
                leagueId: row.leagueId,
                commentaryTelemetry: {
                  evaluated: 0,
                  featured: 0,
                  emitted: 0,
                  skippedDuplicate: 0,
                  skippedMinor: 0,
                  skippedEmpty: 0,
                } satisfies MatchupCommentaryTelemetry,
              };
            }
            return await processLeague(leagueData, afUserId, season, sportLabel);
          } catch (error) {
            console.error(
              `[Import Sleeper] Failed league ${leagueData.league_id}:`,
              getErrorMessage(error)
            );
            return null;
          }
        })
      )
    );

    const successfulImports = results.filter(
      (result): result is { leagueId: string; commentaryTelemetry: MatchupCommentaryTelemetry } =>
        result !== null
    );
    const imported = successfulImports.length;
    const failed = results.length - imported;
    const commentaryTelemetry = sumCommentaryTelemetry(successfulImports);

    // Fire-and-forget: rank computation, rankings context refresh, and history sync
    // These are non-critical for the import response and can run in the background.
    void (async () => {
      try {
        const legacyUser = await prisma.legacyUser.findUnique({
          where: { sleeperUserId },
          select: { id: true },
        });

        const isLocked = await isPlatformRankLocked(afUserId, "sleeper");
        if (!isLocked) {
          await calculateAndSaveRank(afUserId);
          // Ranking import uses `League.import_*` + `calculateAndSaveRank` only; avoid legacy cache
          // overwriting `user_profiles` XP (see `computeAndSaveRank` in lib/ranking).
          if (!isLegacy && legacyUser) {
            await computeAndSaveRank(afUserId, legacyUser);
          }
          await lockPlatformRank(afUserId, "sleeper");
        } else if (isLegacy) {
          await calculateAndSaveRank(afUserId);
        }
      } catch (err) {
        console.error("[import-sleeper] rank lock error:", err);
      }

      try {
        await refreshUserRankingsContext(afUserId);
      } catch (err) {
        console.error("[import-sleeper] rankings context error:", err);
      }

      if (!isLegacy) {
        for (let i = 0; i < leaguesData.length; i++) {
          const row = results[i];
          if (!row) continue;
          const platformLeagueId = leaguesData[i]?.league_id?.toString();
          if (!platformLeagueId) continue;
          void syncLeagueHistory(row.leagueId, platformLeagueId, afUserId).catch((err) =>
            console.error(`[import-sleeper] History sync failed for ${platformLeagueId}:`, err)
          );
        }
      }
    })();

    // userId = AllFantasy account (primary). sleeperUserId = Sleeper provider id (imports only).
    return NextResponse.json({
      success: true,
      userId: afUserId,
      imported,
      failed,
      total: leaguesData.length,
      isLegacy,
      provider: "sleeper",
      sport,
      season,
      commentaryTelemetry,
      sleeperUserId,
      sleeperUsername: sleeperUsernameResolved,
    });
  } catch (error) {
    console.error("[Import Sleeper]", error);

    return NextResponse.json(
      { error: getErrorMessage(error) || "Import failed" },
      { status: 500 }
    );
  }
}
