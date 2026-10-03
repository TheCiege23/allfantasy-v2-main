import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  preparationContext,
  preparationFormatKey,
  preparationPlayerKey,
  type PreparationSnapshot,
} from "@/lib/core-app/draftPreparationModel";
import { isDraftPickRowEmpty } from "@/lib/live-draft-engine/draftPickEmpty";

/** Separate exact-context cohort; never borrow the legacy table's standard-roster defaults. */
export interface PreparationSample {
  playerName: string;
  position: string | null;
  overall: number;
  source: string | null;
  assetType: string | null;
  pickMetadata: unknown;
  session: {
    id?: string;
    sessionKind: string;
    sleeperDraftId?: string | null;
    draftType: string;
    teamCount: number;
    playerPool?: string;
    draftModeLabel?: string | null;
    league: {
      sport: string;
      season: number;
      scoring: string | null;
      isDynasty: boolean;
      leagueVariant: string | null;
      settings?: unknown;
    } | null;
  };
}
export function preparationSnapshotGroups(
  rows: PreparationSample[],
  observedAt: Date,
): Array<PreparationSnapshot & { totalDrafts: number }> {
  const groups = new Map<
    string,
    {
      snapshot: PreparationSnapshot;
      picks: Map<string, number[]>;
      sessions: Set<string>;
    }
  >();
  for (const row of rows) {
    if (
      row.session.sessionKind !== "live" ||
      !!row.session.sleeperDraftId ||
      !row.session.league ||
      !row.playerName?.trim() ||
      !row.position?.trim() ||
      !Number.isInteger(row.overall) ||
      row.overall < 1 ||
      ![null, "player"].includes(row.assetType) ||
      [
        "test_seed",
        "undone",
        "corrected",
        "deleted",
        "keeper",
        "devy",
        "college",
        "promoted_devy",
      ].includes(row.source ?? "") ||
      isDraftPickRowEmpty(row) ||
      row.position === "SKIP" ||
      !["snake", "linear"].includes(row.session.draftType)
    )
      continue;
    const context = preparationContext(row.session.league, row.session);
    if (!context) continue;
    const key = preparationFormatKey(context);
    let group = groups.get(key);
    if (!group) {
      group = {
        snapshot: {
          version: 1,
          provider: "AllFantasy",
          context,
          observedAt: observedAt.toISOString(),
          entries: [],
        },
        picks: new Map(),
        sessions: new Set(),
      };
      groups.set(key, group);
    }
    if (row.session.id) group.sessions.add(row.session.id);
    const playerKey = preparationPlayerKey(row.playerName, row.position);
    if (!group.picks.has(playerKey)) {
      group.picks.set(playerKey, []);
      group.snapshot.entries.push({
        playerKey,
        playerName: row.playerName.trim(),
        position: row.position.trim().toUpperCase(),
        adp: 0,
        sampleSize: 0,
        minPick: 0,
        maxPick: 0,
        standardDeviation: null,
      });
    }
    group.picks.get(playerKey)!.push(row.overall);
  }
  for (const group of groups.values())
    for (const entry of group.snapshot.entries) {
      const picks = group.picks.get(entry.playerKey)!;
      entry.adp = picks.reduce((a, b) => a + b, 0) / picks.length;
      entry.sampleSize = picks.length;
      entry.minPick = Math.min(...picks);
      entry.maxPick = Math.max(...picks);
      entry.standardDeviation =
        picks.length > 1
          ? Math.sqrt(
              picks.reduce((sum, p) => sum + (p - entry.adp) ** 2, 0) /
                picks.length,
            )
          : null;
    }
  return [...groups.values()].map((g) => ({
    ...g.snapshot,
    totalDrafts: g.sessions.size,
  }));
}
export async function persistPreparationSnapshotHistory(
  rows: PreparationSample[],
  observedAt = new Date(),
): Promise<string[]> {
  const errors: string[] = [];
  for (const snapshot of preparationSnapshotGroups(rows, observedAt)) {
    try {
      await prisma.aiAdpSnapshotHistory.create({
        data: {
          sport: snapshot.context.sport,
          leagueType: "draft_hq",
          formatKey: preparationFormatKey(snapshot.context),
          computedAt: observedAt,
          snapshotData: snapshot as unknown as Prisma.InputJsonValue,
          totalDrafts: snapshot.totalDrafts,
          totalPicks: snapshot.entries.reduce(
            (sum, e) => sum + e.sampleSize,
            0,
          ),
          runMeta: {
            schemaVersion: "hq-adp-v1",
            provider: "AllFantasy",
            coverage: "native_observed_context",
            externalRights: "not_applicable",
          },
        },
      });
    } catch {
      errors.push("Draft preparation snapshot history could not be preserved");
    }
  }
  return errors;
}
