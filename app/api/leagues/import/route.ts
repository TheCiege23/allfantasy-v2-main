import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveOrCreateLegacyUser } from "@/lib/legacy-user-resolver";
import { linkAfUserToLegacy } from "@/lib/legacy/linkAfUserToLegacy";
import { processImportJob } from "@/lib/import/processImportJob";
import { canChainImportSteps, scheduleImportSeasonStep } from "@/lib/import/triggerImportChain";
import { SLEEPER_IMPORT_SPORTS } from "@/lib/league-import/sleeper/import-sports";
import { isMissingDatabaseObjectError } from "@/lib/prisma/schema-drift";
import { consumeDailyLimit } from "@/lib/rate-limit-daily";
import { waitUntil } from "@vercel/functions";
import { getSleeperUser, getUserLeagues } from "@/lib/sleeper-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LAUNCH_YEAR = 2017;

/**
 * Fast response: resolve Sleeper user, discover NFL seasons (2017→current), create job, background import.
 * `LegacyImportJob.userId` must reference `LegacyUser`; `appUserId` is the logged-in App user.
 */
export async function POST(req: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const platformRaw =
      typeof body.platform === "string" ? String(body.platform).trim().toLowerCase() : "";
    if (platformRaw && platformRaw !== "sleeper") {
      return NextResponse.json(
        {
          error:
            "Bulk multi-season import runs on Sleeper only. Use Fetch & Preview on the Import page for ESPN, Yahoo, Fantrax, or MFL, or connect accounts in Settings.",
          code: "BULK_IMPORT_SLEEPER_ONLY",
        },
        { status: 400 },
      );
    }

    const raw =
      (typeof body.username === "string" && body.username) ||
      (typeof body.sleeperUsername === "string" && body.sleeperUsername) ||
      "";
    const sleeperUsername = raw.trim();
    if (!sleeperUsername) {
      return NextResponse.json({ error: "Username required" }, { status: 400 });
    }

    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string };
    } | null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const sleeperUser = await getSleeperUser(sleeperUsername).catch(() => null);
    if (!sleeperUser?.user_id) {
      return NextResponse.json({ error: "Sleeper user not found" }, { status: 404 });
    }
    const sleeperUserId = sleeperUser.user_id;

    /**
     * Per-user rate-limit bypass: TheCiege24 (Sleeper username) skips the
     * once-per-day cap. Compare both the request input and the Sleeper API
     * canonical name, case-insensitive, so casing/whitespace can't break it.
     */
    const RATE_LIMIT_BYPASS_SLEEPER_USERNAMES = new Set(["theciege24"]);
    const requestedNameLower = sleeperUsername.toLowerCase();
    const canonicalNameLower = (sleeperUser.username ?? "").toLowerCase();
    const isBypassedSleeperUsername =
      RATE_LIMIT_BYPASS_SLEEPER_USERNAMES.has(requestedNameLower) ||
      RATE_LIMIT_BYPASS_SLEEPER_USERNAMES.has(canonicalNameLower);

    if (!isBypassedSleeperUsername) {
      const dailyBulkImport = await consumeDailyLimit({
        provider: "sleeper",
        endpoint: `league-import-bulk:${sleeperUserId}`,
      });
      if (!dailyBulkImport.success) {
        return NextResponse.json(
          {
            error: "Bulk Sleeper import is limited to once per day for this Sleeper account.",
            retryAfterSec: dailyBulkImport.retryAfterSec,
          },
          { status: 429 },
        );
      }
    }

    await prisma.userProfile
      .upsert({
        where: { userId },
        update: {
          sleeperUsername: sleeperUser.username ?? sleeperUsername,
          sleeperUserId,
          sleeperLinkedAt: new Date(),
        },
        create: {
          userId,
          sleeperUsername: sleeperUser.username ?? sleeperUsername,
          sleeperUserId,
          sleeperLinkedAt: new Date(),
        },
      })
      .catch(() => {});

    const resolvedLegacy = await resolveOrCreateLegacyUser(sleeperUsername);
    if (!resolvedLegacy) {
      return NextResponse.json({ error: "Could not resolve Sleeper legacy profile for this username." }, { status: 502 });
    }
    const linkedLegacy = await linkAfUserToLegacy(userId, resolvedLegacy, { skipComputeRank: true });
    if (!linkedLegacy.ok) {
      return linkedLegacy.response;
    }

    const currentYear = new Date().getFullYear();
    const seasons: number[] = [];
    for (let year = LAUNCH_YEAR; year <= currentYear; year++) {
      let hasLeagues = false;
      for (const sport of SLEEPER_IMPORT_SPORTS) {
        if (hasLeagues) break;
        try {
          const data = await getUserLeagues(sleeperUserId, sport, String(year));
          if (Array.isArray(data) && data.length > 0) {
            hasLeagues = true;
          }
        } catch {
          /* skip sport/year */
        }
      }
      if (hasLeagues) seasons.push(year);
    }

    if (seasons.length === 0) {
      return NextResponse.json({ error: "No leagues found" }, { status: 404 });
    }

    let job: { id: string };
    try {
      job = await prisma.legacyImportJob.create({
        data: {
          userId: resolvedLegacy.id,
          appUserId: userId,
          status: "running",
          progress: 0,
          totalSeasons: seasons.length,
          seasonsCompleted: 0,
          totalLeaguesSaved: 0,
          startedAt: new Date(),
        },
      });

      try {
        await prisma.importJobSeason.createMany({
          data: seasons.map((season) => ({
            jobId: job.id,
            season,
            status: "pending",
          })),
        });
      } catch (e: unknown) {
        console.warn("[import] importJobSeason seed:", e);
      }
    } catch (e: unknown) {
      if (isMissingDatabaseObjectError(e)) {
        console.error(
          "[import] LegacyImportJob schema out of date — apply migration 20260410130000_repair_legacy_import_job_schema (npm run db:migrate:deploy):",
          e,
        );
        return NextResponse.json(
          {
            error:
              "League import is unavailable until the database is updated. Our team has been notified — try again after the next deploy.",
            code: "IMPORT_SCHEMA_UPDATE_REQUIRED",
          },
          { status: 503 },
        );
      }
      throw e;
    }

    const runFullImport = () =>
      processImportJob(job.id, userId, sleeperUserId, seasons).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        const stack = e instanceof Error ? e.stack : undefined;
        console.error("[import] background worker crashed:", msg);
        console.error("[import] stack:", stack);
        return prisma.legacyImportJob
          .update({
            where: { id: job.id },
            data: {
              status: "error",
              error: e instanceof Error ? e.message : String(e),
              completedAt: new Date(),
            },
          })
          .catch(() => null);
      });

    /** Vercel serverless drops fire-and-forget work after the response — chain one season per request when secrets + URL exist. */
    if (canChainImportSteps()) {
      scheduleImportSeasonStep({
        jobId: job.id,
        userId,
        sleeperUserId,
        seasons,
        seasonIndex: 0,
      });
    } else {
      try {
        waitUntil(runFullImport());
      } catch {
        void runFullImport();
      }
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      totalSeasons: seasons.length,
      seasons,
      message: `Found ${seasons.length} seasons to import`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Import failed";
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[import] error:", msg, stack);
    return NextResponse.json(
      { error: msg.length > 0 && msg !== "Import failed" ? msg : "Import failed" },
      { status: 500 },
    );
  }
}
