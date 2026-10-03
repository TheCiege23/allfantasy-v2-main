import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  history: vi.fn(),
  picks: vi.fn(),
  queue: vi.fn(),
  preference: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAdpSnapshotHistory: { findFirst: db.history, create: db.create },
    draftPick: { findMany: db.picks },
    draftQueue: { findUnique: db.queue },
    liveDraftAutopickPreference: { findUnique: db.preference },
  },
}));
import {
  getDraftPreparationData,
  type PreparationSession,
} from "@/lib/core-app/draftPreparation";
import {
  preparationContext,
  preparationPlayerKey,
} from "@/lib/core-app/draftPreparationModel";
import { persistPreparationSnapshotHistory } from "@/lib/adp/preparationSnapshotWriter";
const league = {
  id: "league",
  sport: "NFL",
  season: 2026,
  scoring: "ppr",
  isDynasty: false,
  leagueVariant: null,
  settings: {
    roster_positions: ["QB", "WR", "WR", "RB"],
    scoring_settings: { rec: 1 },
  },
};
const session: PreparationSession = {
  id: "selected",
  status: "pre_draft",
  draftType: "snake",
  rounds: 3,
  teamCount: 2,
  slotOrder: [
    { slot: 1, rosterId: "a", displayName: "A" },
    { slot: 2, rosterId: "b", displayName: "B" },
  ],
  tradedPicks: [],
  keeperSelections: [],
  thirdRoundReversal: false,
  startedAt: null,
  playerPool: "all",
  draftModeLabel: "standard",
  sleeperDraftId: null,
  customRankingsEnabled: true,
};
const entry = {
  playerId: "player-1",
  playerKey: preparationPlayerKey("Player", "WR", "player-1"),
  playerName: "Player",
  position: "WR",
  adp: 2,
  sampleSize: 10,
  minPick: 1,
  maxPick: 3,
  standardDeviation: 1,
};
function snapshot(s = session) {
  return {
    snapshotData: {
      version: 1,
      provider: "AllFantasy",
      context: preparationContext(league, s),
      observedAt: "2026-08-01T00:00:00Z",
      entries: [entry],
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  db.history.mockResolvedValue(snapshot());
  db.picks.mockResolvedValue([]);
  db.queue.mockResolvedValue({ order: [] });
  db.preference.mockResolvedValue({ enabled: false, mode: "standard" });
  db.create.mockResolvedValue({});
});
describe("draft preparation source binding", () => {
  it("pins the query and comparisons before native draft start", async () => {
    const started = {
      ...session,
      status: "completed",
      startedAt: new Date("2026-08-02T00:00:00Z"),
    };
    db.picks.mockResolvedValue([
      {
        overall: 4,
        playerId: "player-1",
        playerName: "Player",
        position: "WR",
        rosterId: "a",
        displayName: "A",
        pickMetadata: null,
      },
    ]);
    const result = await getDraftPreparationData(
      league,
      started,
      "viewer",
      "a",
    );
    expect(db.history.mock.calls[0][0].where.computedAt).toEqual({
      lte: started.startedAt,
    });
    expect(db.picks.mock.calls[0][0].where).toEqual({ sessionId: "selected" });
    expect(result.comparisons[0]).toMatchObject({
      adp: 2,
      difference: 2,
      sampleSize: 10,
    });
    expect(result.outlook).toEqual([]);
  });
  it("does not assign a benchmark to a different player with the same name", async () => {
    db.picks.mockResolvedValue([
      {
        playerId: "player-2",
        overall: 1,
        playerName: "Player",
        position: "WR",
        rosterId: "a",
        displayName: "A",
        pickMetadata: null,
      },
    ]);
    const result = await getDraftPreparationData(
      league,
      session,
      "viewer",
      "a",
    );
    expect(result.comparisons[0]).toMatchObject({
      adp: null,
      difference: null,
      sampleSize: null,
    });
  });
  it("refuses a future snapshot even if a store returns it", async () => {
    db.history.mockResolvedValue({
      snapshotData: {
        ...snapshot().snapshotData,
        observedAt: "2026-08-04T00:00:00Z",
      },
    });
    const result = await getDraftPreparationData(
      league,
      {
        ...session,
        status: "completed",
        startedAt: new Date("2026-08-02T00:00:00Z"),
      },
      "viewer",
    );
    expect(result.state).toBe("empty");
    expect(result.players).toEqual([]);
  });
  it("does not use database ingestion time when start is unknown", async () => {
    expect(
      (
        await getDraftPreparationData(
          league,
          { ...session, status: "completed" },
          "viewer",
        )
      ).state,
    ).toBe("unsupported");
    expect(db.history).not.toHaveBeenCalled();
  });
  it("filters taken queue names and distinguishes empty from failed reads", async () => {
    db.picks.mockResolvedValue([
      {
        overall: 1,
        playerId: "player-1",
        playerName: "Player",
        position: "WR",
        rosterId: "a",
        displayName: "A",
        pickMetadata: null,
      },
    ]);
    db.queue.mockResolvedValue({
      order: [{ playerName: "Player", position: "WR" }],
    });
    let result = await getDraftPreparationData(league, session, "viewer");
    expect(result.queue).toMatchObject({ state: "empty", count: 0 });
    expect(result.players).toEqual([]);
    db.queue.mockRejectedValue(new Error("unavailable"));
    result = await getDraftPreparationData(league, session, "viewer");
    expect(result.queue).toMatchObject({ state: "error", count: null });
  });
  it("does not infer provider queue or native pick ownership", async () => {
    const result = await getDraftPreparationData(
      league,
      { ...session, sleeperDraftId: "provider" },
      "viewer",
    );
    expect(result.queue.state).toBe("unsupported");
    expect(result.outlook).toEqual([]);
    expect(db.queue).not.toHaveBeenCalled();
  });
  it("keeps identical new redraft teams tied and scopes preferences by viewer", async () => {
    const a = await getDraftPreparationData(league, session, "one"),
      b = await getDraftPreparationData(league, session, "two");
    expect(a.outlook.map((t) => [t.rank, t.score])).toEqual([
      [1, 50],
      [1, 50],
    ]);
    expect(a.preferenceScope).not.toBe(b.preferenceScope);
  });
  it("does not infer dynasty roster strength from keepers alone", async () => {
    expect(
      (
        await getDraftPreparationData(
          { ...league, isDynasty: true },
          session,
          "viewer",
        )
      ).outlook,
    ).toEqual([]);
  });
  it("consumes the engine keeper lock once after trades, leaving other acquired picks free", async () => {
    const s = {
      ...session,
      tradedPicks: [
        {
          round: 1,
          originalRosterId: "a",
          newRosterId: "b",
          newOwnerName: "B",
        },
      ],
      keeperSelections: [
        {
          rosterId: "a",
          playerId: "player-1",
          playerName: "Player",
          position: "WR",
          roundCost: 1,
        },
      ],
    };
    db.history.mockResolvedValue(snapshot(s));
    const result = await getDraftPreparationData(league, s, "viewer", "b");
    expect(result.keeperCosts[0]).toMatchObject({
      teamName: "B",
      costOverall: 1,
      adp: 2,
      difference: -1,
    });
    expect(result.outlook.find((t) => t.id === "b")?.roster).toBeCloseTo(100);
    expect(result.players).toEqual([]);
  });
  it("counts a materialized keeper only once when checking uncovered roster slots", async () => {
    const s = {
      ...session,
      keeperSelections: [
        { rosterId: "a", playerId: "player-1", playerName: "Player", position: "WR", roundCost: 1 },
      ],
    };
    db.history.mockResolvedValue({
      snapshotData: {
        ...snapshot(s).snapshotData,
        entries: [
          entry,
          {
            ...entry,
            playerId: "player-2",
            playerName: "Other",
            playerKey: preparationPlayerKey("Other", "WR", "player-2"),
            adp: 3,
          },
        ],
      },
    });
    db.picks.mockResolvedValue([
      {
        overall: 1,
        playerId: "player-1",
        playerName: "Player",
        position: "WR",
        rosterId: "a",
        displayName: "A",
        pickMetadata: null,
      },
    ]);
    const result = await getDraftPreparationData(league, s, "viewer", "a");
    expect(result.players[0]).toMatchObject({
      playerName: "Other",
      rosterFit: true,
    });
  });
  it("never uses pick-order ADP for auction prices", async () => {
    const result = await getDraftPreparationData(
      league,
      { ...session, draftType: "auction" },
      "viewer",
    );
    expect(result.state).toBe("unsupported");
    expect(db.history).not.toHaveBeenCalled();
  });
  it("never writes while loading the page", async () => {
    await getDraftPreparationData(league, session, "viewer");
    expect(db.create).not.toHaveBeenCalled();
  });
  it("appends immutable observations without updating historical records", async () => {
    const row = {
      playerId: "player-1",
      playerName: "Player",
      position: "WR",
      overall: 1,
      source: "user",
      assetType: "player",
      pickMetadata: null,
      session: { ...session, sessionKind: "live", league },
    };
    await persistPreparationSnapshotHistory(
      [row],
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(db.create).toHaveBeenCalledOnce();
    expect(db.create.mock.calls[0][0].data.snapshotData.context).toEqual(
      preparationContext(league, session),
    );
  });
});
