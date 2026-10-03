import { describe, it, expect } from "vitest";
import {
  preparationContext,
  preparationFormatKey,
  preparationPlayerKey,
  validPreparationSnapshot,
  pickAdpDifference,
  preDraftOutlook,
  preparationPlayers,
  type PreparationSnapshot,
} from "@/lib/core-app/draftPreparationModel";
import { preparationSnapshotGroups } from "@/lib/adp/preparationSnapshotWriter";
const league = {
  sport: "NFL",
  season: 2026,
  scoring: "ppr",
  isDynasty: false,
  leagueVariant: null,
  settings: {
    roster_positions: ["QB", "WR", "WR", "RB", "RB", "TE", "FLEX", "BN"],
    scoring_settings: { rec: 1, pass_td: 4 },
  },
};
const session = {
  id: "draft",
  sessionKind: "live",
  draftType: "snake",
  teamCount: 12,
  playerPool: "all",
  draftModeLabel: "standard",
  league,
};
const context = preparationContext(league, session)!;
const entry = {
  playerKey: preparationPlayerKey("Player", "WR"),
  playerName: "Player",
  position: "WR",
  adp: 10,
  sampleSize: 12,
  minPick: 8,
  maxPick: 12,
  standardDeviation: 2,
};
const snapshot: PreparationSnapshot = {
  version: 1,
  provider: "AllFantasy",
  context,
  observedAt: "2026-08-01T00:00:00Z",
  entries: [entry],
};
const cutoff = new Date("2026-08-02T00:00:00Z");
describe("exact draft preparation benchmarks", () => {
  it("reads canonical native roster counts and scoring snapshots without assuming 1QB", () => {
    const native = preparationContext(
      {
        ...league,
        settings: {
          league_type: "keeper",
          rosterSettings: {
            starter_slots: { QB: 1, SUPER_FLEX: 1, WR: 2 },
            benchSlots: 5,
          },
          foundation_defaults: { scoring: { rec: 1, pass_td: 6 } },
        },
      },
      session,
    )!;
    expect(native.leagueType).toBe("keeper");
    expect(native.rosterSlots.filter((x) => x === "WR")).toHaveLength(2);
    expect(native.rosterSlots).toContain("SUPER_FLEX");
    expect(native.rosterSlots.filter((x) => x === "BN")).toHaveLength(5);
    expect(native.scoringRules).toEqual({ rec: 1, pass_td: 6 });
  });
  it("requires explicit scoring and roster slots instead of 1QB defaults", () => {
    expect(preparationContext({ ...league, settings: {} }, session)).toBeNull();
    expect(
      preparationContext(
        { ...league, scoring: null, settings: { roster_positions: ["WR"] } },
        session,
      ),
    ).toBeNull();
  });
  it.each([
    { teamCount: 10 },
    { playerPool: "rookies_only" },
    { draftModeLabel: "startup" },
    { draftType: "auction" },
  ])("separates context %j", (override) => {
    const other = preparationContext(league, { ...session, ...override })!;
    expect(preparationFormatKey(other)).not.toBe(preparationFormatKey(context));
    expect(validPreparationSnapshot(snapshot, other, cutoff)).toBeNull();
  });
  it("separates superflex and exact scoring rules", () => {
    for (const settings of [
      {
        roster_positions: ["QB", "SUPER_FLEX"],
        scoring_settings: { rec: 1, pass_td: 4 },
      },
      { ...league.settings, scoring_settings: { rec: 1, pass_td: 6 } },
    ]) {
      const other = preparationContext({ ...league, settings }, session)!;
      expect(validPreparationSnapshot(snapshot, other, cutoff)).toBeNull();
    }
  });
  it("canonicalizes object property and slot order without losing slot counts", () => {
    expect(
      preparationFormatKey(
        preparationContext(
          {
            ...league,
            settings: {
              scoring_settings: { pass_td: 4, rec: 1 },
              roster_positions: [...league.settings.roster_positions].reverse(),
            },
          },
          session,
        )!,
      ),
    ).toBe(preparationFormatKey(context));
  });
  it("rejects future observations and mismatched seasons", () => {
    expect(
      validPreparationSnapshot(
        { ...snapshot, observedAt: "2026-08-03T00:00:00Z" },
        context,
        cutoff,
      ),
    ).toBeNull();
    expect(
      validPreparationSnapshot(snapshot, { ...context, season: 2025 }, cutoff),
    ).toBeNull();
    expect(validPreparationSnapshot(snapshot, context, cutoff)).toEqual(
      snapshot,
    );
  });
  it("rejects corrupt observations instead of silently regrading a subset", () => {
    expect(
      validPreparationSnapshot(
        { ...snapshot, entries: [{ ...entry, adp: NaN }] },
        context,
        cutoff,
      ),
    ).toBeNull();
    expect(
      validPreparationSnapshot(
        { ...snapshot, entries: [entry, entry] },
        context,
        cutoff,
      ),
    ).toBeNull();
  });
  it("labels later and earlier ADP differences and leaves missing values null", () => {
    expect(pickAdpDifference(15, 10)).toBe(5);
    expect(pickAdpDifference(5, 10)).toBe(-5);
    expect(pickAdpDifference(15, null)).toBeNull();
    expect(pickAdpDifference(0, 10)).toBeNull();
  });
  it("excludes taken/keeper targets and measures uncovered direct slots", () => {
    expect(
      preparationPlayers(snapshot, new Set([entry.playerKey]), []),
    ).toEqual([]);
    expect(
      preparationPlayers(snapshot, new Set(), ["WR", "WR"])[0].rosterFit,
    ).toBe(false);
    expect(preparationPlayers(snapshot, new Set(), ["WR"])[0].rosterFit).toBe(
      true,
    );
  });
});
describe("explainable pre-draft outlook", () => {
  const teams = [
    { id: "a", name: "A", capital: 3, flexibility: 12, keeperValue: 0 },
    { id: "b", name: "B", capital: 2, flexibility: 12, keeperValue: 0 },
  ];
  it("ties equivalent fresh redraft teams", () => {
    expect(preDraftOutlook(teams, true).map((t) => [t.rank, t.score])).toEqual([
      [1, 50],
      [1, 50],
    ]);
  });
  it("uses published normalization and 45/35/20 weights", () => {
    const rows = preDraftOutlook(teams, false);
    expect(rows[0]).toMatchObject({
      roster: 50,
      capital: 100,
      flexibility: 50,
      score: 67.5,
    });
    expect(rows[1].score).toBe(32.5);
  });
  it("does not substitute zero for missing keeper values", () => {
    expect(
      preDraftOutlook([{ ...teams[0], keeperValue: null }, teams[1]], false),
    ).toEqual([]);
  });
});
describe("immutable native snapshot cohorts", () => {
  const row = {
    playerName: "Player",
    position: "WR",
    overall: 10,
    source: "user",
    assetType: "player",
    pickMetadata: null,
    session,
  };
  it("aggregates exact-context observed picks with sample and dispersion", () => {
    const rows = preparationSnapshotGroups(
      [row, { ...row, overall: 20, session: { ...session, id: "second" } }],
      cutoff,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      totalDrafts: 2,
      observedAt: cutoff.toISOString(),
      entries: [
        {
          adp: 15,
          sampleSize: 2,
          minPick: 10,
          maxPick: 20,
          standardDeviation: 5,
        },
      ],
    });
  });
  it("does not blend player pools or rookie/startup purposes", () => {
    expect(
      preparationSnapshotGroups(
        [
          row,
          {
            ...row,
            session: {
              ...session,
              playerPool: "rookies_only",
              draftModeLabel: "rookie",
            },
          },
        ],
        cutoff,
      ),
    ).toHaveLength(2);
  });
  it.each(["keeper", "test_seed", "undone", "corrected", "devy"])(
    "excludes non-market selections %s",
    (source) => {
      expect(preparationSnapshotGroups([{ ...row, source }], cutoff)).toEqual(
        [],
      );
    },
  );
  it("excludes auctions, mocks, skips and cleared slots", () => {
    for (const r of [
      { ...row, session: { ...session, draftType: "auction" } },
      { ...row, session: { ...session, sessionKind: "mock" } },
      { ...row, session: { ...session, sleeperDraftId: "provider-draft" } },
      { ...row, position: "SKIP" },
      { ...row, pickMetadata: { pickEditorEmpty: true } },
    ])
      expect(preparationSnapshotGroups([r], cutoff)).toEqual([]);
  });
});
