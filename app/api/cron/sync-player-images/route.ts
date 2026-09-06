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
import { recordSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry";

/**
 * ⚠ THE HEARTBEAT IS PER SPORT, AND THAT IS THE ENTIRE POINT OF IT.
 *
 * Three schedules hit this one route — `?sport=all`, `?sport=NFL` and `?sport=NCAAF` — and all
 * three write the SAME `sports_core_player_images.fetched_at`. A freshness probe on that column
 * is therefore satisfied for all three the moment any one of them runs, so the two sport-scoped
 * schedules could die silently while the daily `?sport=all` pass kept the probe green. That is
 * the false green `scripts/cron-freshness-check.mjs` exists to prevent, and its NO_PROBE entries
 * for the NFL and NCAAF modes named this fix.
 *
 * A single job name would move the collision from the image table into `sync_job_runs` rather
 * than removing it, so the name carries the requested sport. `?sport=all` keeps its TABLE probe —
 * it writes unconditionally, and an output probe is the stronger check where one is available.
 *
 * Must stay in step with PROBES in scripts/cron-freshness-check.mjs; renaming here alone makes
 * the monitor report CONFIG ("no rows for job_name") forever.
 */
/*
 * ⚠ THE NAMES ARE LITERALS, NOT BUILT FROM A TEMPLATE, AND THAT IS DELIBERATE.
 *
 * `__tests__/cron-heartbeat-route-contracts.test.ts` asserts that every name PROBES expects
 * appears verbatim in the route that records it — which is what stops a probe and its route
 * drifting apart into a permanent CONFIG report. A computed `cron-sync-player-images-${slug}`
 * satisfies the runtime and defeats that check, because the string never exists in the source
 * for the test (or for a human with grep) to find. It was written that way first and the
 * contract test caught it.
 *
 * An unscheduled ad-hoc sport still gets a usable name from the fallback; only the three
 * SCHEDULED modes need to be greppable, because only those are probed.
 */
const JOB_BY_SPORT: Record<string, string> = {
  all: "cron-sync-player-images-all",
  nfl: "cron-sync-player-images-nfl",
  ncaaf: "cron-sync-player-images-ncaaf",
};

const jobNameForSport = (raw: string | null): string => {
  const slug = (raw ?? "all").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "all";
  return JOB_BY_SPORT[slug] ?? `cron-sync-player-images-${slug}`;
};

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

/**
 * Positions worth spending the image budget on first, per sport.
 *
 * These are the players who appear on a roster, a draft board, a trade screen or a waiver list —
 * i.e. the only ones whose missing headshot a user ever notices. A sport absent from this map
 * simply has no priority tier and falls back to the previous flat ordering, so adding a sport is
 * additive and never regresses one.
 *
 * Kept in step with `FANTASY_POSITIONS` in `lib/redraft-war-room/redraftFreeAgentPool.ts` for the
 * football codes, including IDP — an IDP league's defenders are as visible as its running backs.
 */
const FANTASY_POSITIONS_BY_SPORT: Record<string, string[]> = {
  NFL: [
    "QB", "RB", "FB", "HB", "WR", "TE", "K", "PK",
    "DST", "DEF", "D/ST", "DEF/ST",
    "DL", "DE", "DT", "EDGE", "LB", "ILB", "OLB", "MLB",
    "DB", "CB", "S", "FS", "SS",
  ],
  NCAAF: [
    "QB", "RB", "FB", "HB", "WR", "TE", "K", "PK",
    "DL", "DE", "DT", "EDGE", "LB", "ILB", "OLB", "MLB",
    "DB", "CB", "S", "FS", "SS",
  ],
  NBA: ["PG", "SG", "SF", "PF", "C", "G", "F"],
  NCAAB: ["PG", "SG", "SF", "PF", "C", "G", "F"],
  NHL: ["C", "LW", "RW", "D", "G"],
  MLB: ["P", "SP", "RP", "C", "1B", "2B", "3B", "SS", "OF", "LF", "CF", "RF", "DH"],
  SOCCER: ["GK", "DEF", "MID", "FWD"],
};
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
export async function syncTeamLogos(
  sport: string,
  dryRun: boolean,
  /*
   * 🛑 THE ONE LOOP IN THIS ROUTE THAT HAD NO DEADLINE, AND THE ONLY PLACE IT COULD OVERRUN.
   *
   * Everything else here is bounded properly: the shared 240s budget is checked between sports
   * AND per player inside `resolveBatch`. This pass took neither — it iterated every legacy team
   * with an unbounded `await` each, which is why NCAAF (231 teams, per the header above) finished
   * at 276s against a 240s budget while NFL landed at 241s. Measured from the slow-tier
   * dispatcher log, 2026-09-06 09:07 and 09:20:
   *
   *     -> sync-player-images?sport=NFL   ... OK 200 (241034ms)
   *     -> sync-player-images?sport=NCAAF ... OK 200 (276282ms)
   *
   * Both under the 300s edge, and both on the wrong side of the budget that exists to keep them
   * there. `import-players` and `import-schedules?riProfiles=1` are what this looks like once it
   * crosses: HTTP 502 with the handler still running.
   *
   * ⚠ THE TELL WAS ALREADY IN THE TYPE. `PassSummary.timedOut` was initialised `false` here and
   * never assigned, while both other passes set it — a field that can only ever report one value
   * is a bound nobody wired.
   */
  deadline: number,
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
    /*
     * Checked per team, matching `resolveBatch`. Stopping mid-pass is safe and resumable: this
     * backfills from rows already on disk, so the teams not reached are simply picked up next
     * run — the same drain-and-resume property the player passes rely on.
     */
    if (Date.now() > deadline) {
      summary.timedOut = true;
      break;
    }

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

  const jobName = jobNameForSport(url.searchParams.get("sport"));

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

        /*
         * ── Pass A: canonical players with no image at all ──
         *
         * ⚠ FANTASY-RELEVANT PLAYERS FIRST. THE ORDER IS THE WHOLE FIX.
         *
         * This was a flat `orderBy: lastSyncedAt asc` over every imageless player in the sport,
         * spending a bounded daily budget in table order across tables that are overwhelmingly
         * retired, practice-squad and never-rostered players.
         *
         * ⚠ AND THE SPORT THIS MATTERS FOR IS NOT THE NFL. Measured 2026-08-30 against canonical
         * `Player.imageUrl`:
         *
         *     NFL     12,853 / 13,010   (99%)
         *     SOCCER     811 /  2,303   (35%)
         *     NBA        122 /  1,756   (7%)
         *     NHL         94 /  4,109   (2%)
         *     NCAAF       60 / 44,887   (0.1%)   <-- season opens this week
         *     NCAAB        7 / 18,119   (0%)
         *     MLB          4 /  7,291   (0%)
         *
         * The NFL is effectively done, and it also has a CDN fallback the others do not:
         * `lib/sports-data/headshots.ts` builds a Sleeper URL straight from a player id, so most
         * NFL surfaces render a face with no database row at all. Sleeper does not cover college,
         * so for NCAAF a missing row is a missing face — with the season days away.
         *
         * Two tiers, one budget: active + rostered + fantasy-position players are taken first, and
         * only leftover headroom goes to the general population. Paired with the dedicated
         * per-sport sweeps in cron-schedule.json (`?sport=all` rotates the sport order by
         * day-of-year, so NCAAF previously got the budget one day in seven), that is what closes
         * the college gap before kickoff rather than some time next year.
         */
        const priorityPositions = FANTASY_POSITIONS_BY_SPORT[sport];

        const priority = priorityPositions
          ? await prisma.player.findMany({
              where: {
                sport,
                imageUrl: null,
                active: true,
                team: { not: null },
                position: { in: priorityPositions },
              },
              take: limit,
              orderBy: { lastSyncedAt: "asc" },
              select: canonicalSelect,
            })
          : [];

        /* Top up with the general population only if the priority tier did not fill the budget. */
        const backfillRoom = limit - priority.length;
        const backfill =
          backfillRoom > 0
            ? await prisma.player.findMany({
                where: {
                  sport,
                  imageUrl: null,
                  ...(priority.length ? { id: { notIn: priority.map((p) => p.id) } } : {}),
                },
                take: backfillRoom,
                orderBy: { lastSyncedAt: "asc" },
                select: canonicalSelect,
              })
            : [];

        const missing = [...priority, ...backfill];

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
        teams = await syncTeamLogos(sport, dryRun, deadline);
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

    /*
     * Recorded whether or not any image resolved. A sweep that resolves nothing because every
     * player already has a headshot is a HEALTHY run, so counting it as a non-event would make
     * the probe red exactly when the backfill is complete.
     */
    await recordSyncJobRun(
      { jobName, jobScope: perSport.map((s) => s.sport).join(",") || undefined, trigger: "cron" },
      {
        rowsWritten: totals.resolved + totals.teamLogos,
        rowsSkipped: Math.max(0, sports.length - perSport.length),
        /*
         * ⚠ A PASS THAT RAN OUT OF TIME IS REPORTED HERE, NOT ONLY IN THE RESPONSE BODY. The
         * body is read by whoever is looking at that moment; `sync_job_runs` is what anyone
         * asks later, and a run that quietly did two thirds of its work is exactly the thing a
         * freshness probe cannot see on its own.
         */
        warnings: [
          ...(perSport.length < sports.length
            ? [`budget stopped after ${perSport.length}/${sports.length} sports`]
            : []),
          ...perSport
            .filter((s) => s.players.fill.timedOut || s.players.refresh.timedOut || s.teams.timedOut)
            .map((s) => {
              const passes = [
                s.players.fill.timedOut ? "fill" : null,
                s.players.refresh.timedOut ? "refresh" : null,
                s.teams.timedOut ? "teams" : null,
              ].filter(Boolean)
              return `${s.sport}: ran out of budget during ${passes.join("+")}`
            }),
        ],
        metadata: { scope, limit, dryRun, failed: totals.failed },
      },
      Date.now() - startedAt,
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
    /*
     * A FAILED fire still heartbeats. The probe answers "did the scheduler reach this route",
     * and a route that throws every time is still being scheduled — suppressing the row here
     * would report a loudly-failing job as a DEAD one, which sends the next person hunting the
     * scheduler instead of reading the error.
     */
    await recordSyncJobRun({ jobName, trigger: "cron" }, { errors: [message] }, Date.now() - startedAt);
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
