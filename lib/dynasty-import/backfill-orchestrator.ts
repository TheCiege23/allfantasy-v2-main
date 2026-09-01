/**
 * Dynasty historical import — orchestrate backfill: discover seasons, persist incrementally, track status.
 */

import { prisma } from "@/lib/prisma";
import {
  discoverSleeperSeasons,
  fetchSleeperStandings,
  fetchSleeperTradesForSeason,
  fetchSleeperRosterToOwner,
} from "./sleeper-historical";
import { persistStandings, persistDynastySeason, persistTradesForSeason } from "./normalize-historical";
import { isSeasonComplete } from "@/lib/league-import/seasonCompletion";
import type { BackfillStatus, BackfillObservability, HistoricalSeasonRef } from "./types";

export interface DynastyBackfillInput {
  leagueId: string;
  /**
   * If true, run even when league is not marked dynasty.
   *
   * ⚠ THIS IS NOT THE SIBLINGS' `force` AND MUST NOT BE WIRED INTO THE COMPLETION GATE BY
   * ANALOGY. In the draft/season-state/transaction services `force` means "refetch a season we
   * already hold"; here it means "this league is not dynasty, run anyway". Two different
   * questions behind one word. `skipExistingSeasons` is the local equivalent of the other one.
   */
  force?: boolean;
  /** Max seasons to import (oldest first). Omit = all discovered */
  maxSeasons?: number;
  /** Skip seasons that already have SeasonResult rows */
  skipExistingSeasons?: boolean;
}

export interface DynastyBackfillResult {
  success: boolean;
  status: BackfillStatus;
  seasonsDiscovered: number;
  seasonsImported: number;
  seasonsSkipped: number;
  tradesPersisted: number;
  observability: BackfillObservability;
  failureMessage?: string;
}

/**
 * Run historical backfill for a dynasty league (Sleeper). Idempotent and resumable.
 */
export async function runDynastyBackfill(input: DynastyBackfillInput): Promise<DynastyBackfillResult> {
  const { leagueId, force = false, maxSeasons, skipExistingSeasons = true } = input;
  const observability: BackfillObservability = {
    provider: "sleeper",
    seasonsDiscovered: [],
    seasonsImported: [],
    seasonsSkipped: [],
    partialSeasons: [],
    missingFields: [],
    failuresPerSeason: {},
  };

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, platform: true, platformLeagueId: true, userId: true, isDynasty: true },
  });
  if (!league) {
    return {
      success: false,
      status: "failed",
      seasonsDiscovered: 0,
      seasonsImported: 0,
      seasonsSkipped: 0,
      tradesPersisted: 0,
      observability,
      failureMessage: "League not found",
    };
  }
  if (league.platform !== "sleeper") {
    return {
      success: false,
      status: "failed",
      seasonsDiscovered: 0,
      seasonsImported: 0,
      seasonsSkipped: 0,
      tradesPersisted: 0,
      observability,
      failureMessage: "Historical backfill only supported for Sleeper",
    };
  }
  if (!league.isDynasty && !force) {
    return {
      success: false,
      status: "failed",
      seasonsDiscovered: 0,
      seasonsImported: 0,
      seasonsSkipped: 0,
      tradesPersisted: 0,
      observability,
      failureMessage: "League is not marked dynasty; use force=true to run anyway",
    };
  }

  const platformLeagueId = league.platformLeagueId ?? "";
  if (!platformLeagueId) {
    return {
      success: false,
      status: "failed",
      seasonsDiscovered: 0,
      seasonsImported: 0,
      seasonsSkipped: 0,
      tradesPersisted: 0,
      observability,
      failureMessage: "League has no platformLeagueId",
    };
  }

  await prisma.dynastyBackfillStatus.upsert({
    where: {
      uniq_dynasty_backfill_status_league_provider: { leagueId, provider: "sleeper" },
    },
    update: {
      status: "running",
      lastStartedAt: new Date(),
      failureMessage: null,
      updatedAt: new Date(),
    },
    create: {
      leagueId,
      provider: "sleeper",
      status: "running",
      lastStartedAt: new Date(),
    },
  });

  /*
   * ⚠ ANNOTATED WITH THE REAL TYPE, NOT AN INLINE STRUCTURAL ONE. This was
   * `Array<{ platformLeagueId: string; season: number; provider: string }>` — which silently
   * stripped `status` back off the refs `discoverSleeperSeasons` returns, so the completion gate
   * below would have had nothing to read even after the field was added upstream. A narrower
   * local annotation is an easy way to undo a widening two files away and typecheck perfectly.
   */
  let discovered: HistoricalSeasonRef[] = [];
  try {
    discovered = await discoverSleeperSeasons(platformLeagueId, league.userId);
  } catch (e: any) {
    await prisma.dynastyBackfillStatus.update({
      where: { uniq_dynasty_backfill_status_league_provider: { leagueId, provider: "sleeper" } },
      data: { status: "failed", failureMessage: e?.message ?? "Discover failed", updatedAt: new Date() },
    });
    return {
      success: false,
      status: "failed",
      seasonsDiscovered: 0,
      seasonsImported: 0,
      seasonsSkipped: 0,
      tradesPersisted: 0,
      observability,
      failureMessage: e?.message ?? "Discover failed",
    };
  }

  observability.seasonsDiscovered = discovered.map((d) => d.season).sort((a, b) => a - b);
  const toProcess = maxSeasons != null ? discovered.slice(0, maxSeasons) : discovered;
  const sorted = [...toProcess].sort((a, b) => a.season - b.season);
  let seasonsImported = 0;
  let seasonsSkipped = 0;
  let tradesPersisted = 0;

  for (const ref of sorted) {
    try {
      /*
       * ── 🛑 THE FIFTH PLACE THIS GATE SHAPE WAS FOUND ─────────────────────────────────────
       *
       * This used to be `if (skipExistingSeasons)` alone, so a season was skipped whenever a
       * SeasonResult row existed. Importing mid-season writes that row for the season being
       * PLAYED, and every later run then skipped it — standings and trades frozen at the moment
       * of import, with `seasonsSkipped` reporting it as done.
       *
       * The draft, season-state and matchup siblings were fixed in the same way (see
       * `lib/league-import/seasonCompletion.ts`). This one was missed because it lives under
       * `lib/dynasty-import/`, not `lib/league-import/`, and because `HistoricalSeasonRef` had
       * discarded the provider's `status` — so there was nothing here to gate on.
       *
       * ⚠ IT MATTERS MOST NOW, not before. Until this is scheduled the bug is bounded by how
       * rarely anyone re-runs a backfill by hand; on a timer it would freeze the live season of
       * every league the rotation touches.
       */
      if (skipExistingSeasons && isSeasonComplete({ status: ref.status })) {
        const existing = await prisma.seasonResult.findFirst({
          where: { leagueId, season: String(ref.season) },
        });
        if (existing) {
          observability.seasonsSkipped.push(ref.season);
          seasonsSkipped++;
          await persistDynastySeason(leagueId, ref.season, ref.platformLeagueId, ref.provider);
          continue;
        }
      }

      const [standingsRes, rosterToOwner] = await Promise.all([
        fetchSleeperStandings(ref.platformLeagueId),
        fetchSleeperRosterToOwner(ref.platformLeagueId),
      ]);
      await persistStandings(leagueId, ref.season, standingsRes.rows);
      await persistDynastySeason(leagueId, ref.season, ref.platformLeagueId, ref.provider);

      const trades = await fetchSleeperTradesForSeason(ref.platformLeagueId, ref.season);
      const count = await persistTradesForSeason(ref.platformLeagueId, ref.season, trades, rosterToOwner);
      tradesPersisted += count;
      observability.seasonsImported.push(ref.season);
      seasonsImported++;
    } catch (e: any) {
      observability.failuresPerSeason[String(ref.season)] = e?.message ?? "Unknown error";
      observability.partialSeasons.push({ season: ref.season, reason: e?.message ?? "Unknown error" });
    }
  }

  const hasFailures = Object.keys(observability.failuresPerSeason).length > 0;
  const status: BackfillStatus = hasFailures ? "partial" : "completed";
  await prisma.dynastyBackfillStatus.update({
    where: { uniq_dynasty_backfill_status_league_provider: { leagueId, provider: "sleeper" } },
    data: {
      status,
      seasonsDiscovered: observability.seasonsDiscovered as any,
      seasonsImported: observability.seasonsImported as any,
      seasonsSkipped: observability.seasonsSkipped as any,
      partialSeasons: observability.partialSeasons as any,
      lastCompletedAt: new Date(),
      failureMessage: hasFailures ? Object.entries(observability.failuresPerSeason).map(([s, m]) => `${s}: ${m}`).join("; ") : null,
      metadata: { tradesPersisted } as any,
      updatedAt: new Date(),
    },
  });

  return {
    success: !hasFailures,
    status,
    seasonsDiscovered: observability.seasonsDiscovered.length,
    seasonsImported,
    seasonsSkipped,
    tradesPersisted,
    observability,
    failureMessage: hasFailures ? "Some seasons failed" : undefined,
  };
}

/**
 * Get current backfill status for a league.
 */
export async function getDynastyBackfillStatus(leagueId: string, provider: string = "sleeper") {
  return prisma.dynastyBackfillStatus.findUnique({
    where: {
      uniq_dynasty_backfill_status_league_provider: { leagueId, provider },
    },
  });
}
