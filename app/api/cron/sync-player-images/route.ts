/**
 * GET/POST /api/cron/sync-player-images
 *
 * Vercel Cron schedule: daily at 05:10 UTC (see vercel.json).
 *
 * Phase 1 of the canonical player/team data work. Replaces the hand-run
 * `scripts/sync-player-images.ts`, whose `PlayerImage` write was dead code: it passed a
 * `source` field the model does not have and omitted the required `sportKey`/`imageType`,
 * so every call threw straight into a bare `catch {}` and the table stayed empty.
 *
 * Two passes, both bounded by `limit` and a wall-clock budget:
 *   A. **fill**    — players with no image yet; resolve and persist.
 *   B. **refresh** — players whose cached image is past its TTL (team changes, new photos).
 *
 * Resolution goes through `resolvePlayerHeadshot`, which is the same code path a live
 * request uses, so the cron and the request path cannot drift. That call persists into
 * `PlayerImage` itself; this route additionally mirrors the URL onto the legacy
 * `SportsPlayer.imageUrl` column so the existing readers keep working while Phases 2–3
 * migrate them onto the canonical table.
 *
 * Query params:
 *   sport   — sport code to sync (default "NFL")
 *   limit   — max players to resolve per pass (default 50, cap 500)
 *   scope   — "players" | "teams" | "all" (default "all")
 *   dryRun  — "true" to report candidate counts without writing
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/app/api/cron/_auth";
import { prisma } from "@/lib/prisma";
import { createBatchPlayerHeadshotResolver } from "@/lib/player-assets/resolvePlayerHeadshot";
import { PLAYER_IMAGE_TYPE_HEADSHOT } from "@/lib/player-assets/playerImageStore";
import {
  TEAM_IMAGE_TYPE_LOGO,
  writePrimaryTeamImage,
} from "@/lib/sport-teams/teamImageStore";

/**
 * Phase 2: this route is now canonical-first. It iterates `Player` / `Team` and writes images
 * keyed by canonical `Player.id` / `Team.id`, not the `SportsPlayer.id` / `SportsTeam.id`
 * Phase 1 used. The legacy `SportsPlayer.imageUrl` mirror is still maintained — resolved via
 * `Player.providerIds` — so today's readers keep working until Phase 3 migrates them.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** Stop resolving with headroom to spare so the route always returns a real summary. */
const TIME_BUDGET_MS = 240_000;
/** Courtesy delay between provider lookups, matching the script this replaces. */
const PROVIDER_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface PassSummary {
  considered: number;
  resolved: number;
  failed: number;
  timedOut: boolean;
}

/** A canonical player as this route needs it. `id` is `Player.id`. */
interface CanonicalPlayerRow {
  id: string;
  name: string;
  team: string | null;
  sport: string;
  position: string;
  providerIds: unknown;
}

/**
 * Mirror a resolved URL back onto the legacy `SportsPlayer.imageUrl` column.
 *
 * There is no FK from `Player` to `SportsPlayer`, so we route through the `providerIds` map
 * the backfill recorded (`{ source: externalId }`) and match on `SportsPlayer`'s natural key
 * `(sport, externalId, source)`.
 */
async function mirrorToLegacy(
  player: CanonicalPlayerRow,
  imageUrl: string,
): Promise<void> {
  const providerIds = (player.providerIds ?? {}) as Record<string, unknown>;
  for (const [source, externalId] of Object.entries(providerIds)) {
    if (typeof externalId !== "string" || !externalId) continue;
    await prisma.sportsPlayer.updateMany({
      where: { sport: player.sport, source, externalId },
      data: { imageUrl },
    });
  }
}

/**
 * Resolve headshots for a batch of canonical players. `resolve()` performs the canonical
 * `PlayerImage` write-through internally, now keyed by `Player.id`.
 */
async function resolveBatch(
  players: CanonicalPlayerRow[],
  sport: string,
  deadline: number,
  opts: { skipCache: boolean },
): Promise<PassSummary> {
  const summary: PassSummary = {
    considered: players.length,
    resolved: 0,
    failed: 0,
    timedOut: false,
  };
  if (players.length === 0) return summary;

  const resolver = await createBatchPlayerHeadshotResolver({ sport });

  for (const player of players) {
    if (Date.now() > deadline) {
      summary.timedOut = true;
      break;
    }

    try {
      const result = await resolver.resolve({
        name: player.name,
        sport: player.sport,
        team: player.team,
        position: player.position,
        playerId: player.id, // canonical Player.id
        skipCache: opts.skipCache,
      });

      if (result.imageUrl) {
        await prisma.player.update({
          where: { id: player.id },
          data: { imageUrl: result.imageUrl, lastSeenAt: new Date() },
        });
        await mirrorToLegacy(player, result.imageUrl);
        summary.resolved++;
      } else {
        summary.failed++;
      }
    } catch (err) {
      summary.failed++;
      console.warn(
        `[cron/sync-player-images] ${player.name}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    await sleep(PROVIDER_DELAY_MS);
  }

  return summary;
}

/**
 * Backfill `TeamImage` from the logos already stored on `SportsTeam`.
 *
 * Deliberately a sync-time job rather than a request-time write-through: the live team-logo
 * helpers (`lib/players/getTeamLogo.ts`, `lib/player-media-urls.ts`) are synchronous,
 * prisma-free and client-safe by design, so they cannot write to the DB without pulling
 * Prisma into client bundles. See `lib/sport-teams/teamImageStore.ts`.
 */
async function syncTeamLogos(
  sport: string,
  dryRun: boolean,
): Promise<PassSummary> {
  // Logos live on the legacy SportsTeam rows; canonical Team has no logo column. Route each
  // logo to its canonical team through TeamProviderIdentity, which the backfill populated
  // with `(provider, providerTeamId)` = `(SportsTeam.source, SportsTeam.externalId)`.
  const [legacyTeams, identities] = await Promise.all([
    prisma.sportsTeam.findMany({
      where: { sport, logo: { not: null } },
      select: { logo: true, source: true, externalId: true },
    }),
    prisma.teamProviderIdentity.findMany({
      where: { sportKey: sport },
      select: { teamId: true, provider: true, providerTeamId: true },
    }),
  ]);

  const canonicalByProviderKey = new Map(
    identities
      .filter((i) => i.teamId)
      .map((i) => [`${i.provider}|${i.providerTeamId}`, i.teamId as string]),
  );

  const summary: PassSummary = {
    considered: legacyTeams.length,
    resolved: 0,
    failed: 0,
    timedOut: false,
  };
  if (dryRun) return summary;

  for (const team of legacyTeams) {
    const canonicalTeamId = canonicalByProviderKey.get(
      `${team.source}|${team.externalId}`,
    );
    if (!canonicalTeamId) {
      // No canonical team yet — run the Phase 2 backfill first. Skipped rather than written
      // under a legacy id, which is exactly the mixing Phase 2 exists to end.
      summary.failed++;
      continue;
    }

    const write = await writePrimaryTeamImage({
      teamId: canonicalTeamId, // canonical Team.id
      sportKey: sport,
      imageType: TEAM_IMAGE_TYPE_LOGO,
      url: team.logo as string,
      provider: team.source,
      confidence: 1,
    });
    if (write.written) summary.resolved++;
    else summary.failed++;
  }

  return summary;
}

/**
 * Every sport with players in the canonical table, most-covered first.
 *
 * ⚠ ORDER MATTERS AND ROTATES. One invocation shares a single wall-clock
 * budget, so whichever sport runs last gets whatever time is left — which on a
 * bad day is none. A fixed order would therefore starve the same sport every
 * night forever. Rotating the start by day of year means each sport gets first
 * crack roughly once a week.
 *
 * Measured coverage when this was written: NFL 98%, SOCCER 32%, and NBA, NHL,
 * MLB, NCAAF, NCAAB all at 0% — 78k players with no headshot, of which 63k are
 * college. College is a long tail this provider may simply not carry; the pro
 * leagues are the realistic win.
 */
const ALL_SPORTS = [
  "NBA",
  "NHL",
  "MLB",
  "SOCCER",
  "NFL",
  "NCAAF",
  "NCAAB",
] as const;

function rotatedSports(now: Date): string[] {
  const dayOfYear = Math.floor(
    (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86_400_000,
  );
  const offset = dayOfYear % ALL_SPORTS.length;
  return [...ALL_SPORTS.slice(offset), ...ALL_SPORTS.slice(0, offset)];
}

/** Resolve the `sport` param into the list to run: one code, a CSV, or every sport. */
export function resolveSportList(
  raw: string | null,
  now: Date = new Date(),
): string[] {
  const value = (raw ?? "NFL").trim();
  if (!value || value.toUpperCase() === "ALL") return rotatedSports(now);
  return value
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const sports = resolveSportList(url.searchParams.get("sport"));
  const scope = (url.searchParams.get("scope") ?? "all").trim().toLowerCase();
  const dryRun = url.searchParams.get("dryRun") === "true";
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;

  try {
    const doPlayers = scope === "all" || scope === "players";
    const doTeams = scope === "all" || scope === "teams";

    const perSport: Array<{
      sport: string;
      players: { fill: PassSummary; refresh: PassSummary };
      teams: PassSummary;
    }> = [];

    for (const sport of sports) {
      /*
       * ⚠ THE SHARED DEADLINE IS CHECKED BETWEEN SPORTS, NOT ONLY INSIDE THEM.
       * Without this, a sport whose turn comes after the budget is spent would
       * still issue its database queries and its provider calls before
       * discovering there is no time to use the results.
       */
      if (Date.now() > deadline) break;

      let fill: PassSummary = {
        considered: 0,
        resolved: 0,
        failed: 0,
        timedOut: false,
      };
      let refresh: PassSummary = {
        considered: 0,
        resolved: 0,
        failed: 0,
        timedOut: false,
      };
      let teams: PassSummary = {
        considered: 0,
        resolved: 0,
        failed: 0,
        timedOut: false,
      };

      if (doPlayers) {
        const canonicalSelect = {
          id: true,
          name: true,
          team: true,
          sport: true,
          position: true,
          providerIds: true,
        } as const;

        // ── Pass A: canonical players with no image at all ──
        const missing = await prisma.player.findMany({
          where: { sport, imageUrl: null },
          take: limit,
          orderBy: { lastSyncedAt: "asc" },
          select: canonicalSelect,
        });

        // ── Pass B: players whose canonical image has aged out ──
        const stale = await prisma.playerImage.findMany({
          where: {
            sportKey: sport,
            imageType: PLAYER_IMAGE_TYPE_HEADSHOT,
            isPrimary: true,
            expiresAt: { lt: new Date() },
          },
          take: limit,
          orderBy: { expiresAt: "asc" },
          select: { playerId: true },
        });
        const staleIds = stale
          .map((row) => row.playerId)
          .filter((id): id is string => Boolean(id));
        const stalePlayers = staleIds.length
          ? await prisma.player.findMany({
              where: { id: { in: staleIds } },
              select: canonicalSelect,
            })
          : [];

        if (dryRun) {
          fill = {
            considered: missing.length,
            resolved: 0,
            failed: 0,
            timedOut: false,
          };
          refresh = {
            considered: stalePlayers.length,
            resolved: 0,
            failed: 0,
            timedOut: false,
          };
        } else {
          fill = await resolveBatch(missing, sport, deadline, {
            skipCache: false,
          });
          refresh = await resolveBatch(stalePlayers, sport, deadline, {
            skipCache: true,
          });
        }
      }

      if (doTeams) {
        teams = await syncTeamLogos(sport, dryRun);
      }

      perSport.push({ sport, players: { fill, refresh }, teams });
    }

    const totals = perSport.reduce(
      (acc, s) => ({
        resolved:
          acc.resolved + s.players.fill.resolved + s.players.refresh.resolved,
        failed: acc.failed + s.players.fill.failed + s.players.refresh.failed,
        teamLogos: acc.teamLogos + s.teams.resolved,
      }),
      { resolved: 0, failed: 0, teamLogos: 0 },
    );

    return NextResponse.json({
      ok: true,
      dryRun,
      // Which sports were REQUESTED vs which actually ran: a short `ran` list
      // against a long `requested` one is the budget running out, not a bug.
      requested: sports,
      ran: perSport.map((s) => s.sport),
      scope,
      limit,
      totals,
      bySport: perSport,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-player-images] failed:", message);
    return NextResponse.json(
      {
        ok: false,
        error: message.slice(0, 240),
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return handle(req);
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return handle(req);
}
