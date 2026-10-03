import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/components/i18n/LanguageProviderClient", () => ({
  useOptionalLanguage: () => ({ language: "en" }),
}));
import { DraftPreparation } from "@/components/core-app/screens/DraftPreparation";
import type { DraftPreparationData } from "@/lib/core-app/draftPreparation";
const data: DraftPreparationData = {
  state: "ready",
  reason: null,
  sessionId: "s",
  preferenceScope: "viewer-s",
  context: {
    sport: "NFL",
    season: 2026,
    leagueType: "redraft",
    draftType: "snake",
    teamCount: 12,
    scoring: "ppr",
    scoringRules: { rec: 1 },
    rosterSlots: ["WR"],
    playerPool: "all",
    purpose: "standard",
  },
  observedAt: "2026-08-01T00:00:00Z",
  historical: false,
  players: ["A", "B"].map((name, i) => ({
    playerKey: name,
    playerName: name,
    position: "WR",
    adp: i + 1,
    sampleSize: 4,
    minPick: 1,
    maxPick: 3,
    standardDeviation: 1,
    rank: i + 1,
    tier: 1,
    rosterFit: true,
    withinNextRound: 2,
  })),
  comparisons: [
    {
      overall: 5,
      playerName: "C",
      teamName: "Team",
      adp: null,
      difference: null,
      sampleSize: null,
    },
  ],
  outlook: [],
  outlookReason: "Insufficient data",
  keeperCosts: [],
  queue: {
    state: "empty",
    count: 0,
    autopick: "Your personal autopick is disabled.",
  },
  customRankingsEnabled: true,
};
beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe("draft preparation accessible controls", () => {
  it("supports touch/keyboard planning reorders and saves per-draft preferences", () => {
    render(<DraftPreparation data={data} leagueId="l" />);
    fireEvent.click(screen.getByRole("button", { name: "Move down A" }));
    expect(
      JSON.parse(localStorage.getItem("af-draft-preparation-v1:viewer-s")!)
        .order,
    ).toEqual(["B", "A"]);
    expect(screen.getAllByRole("row")[1].textContent).toContain("B");
    fireEvent.click(
      screen.getByRole("button", { name: "Reset planning preferences" }),
    );
    expect(
      JSON.parse(localStorage.getItem("af-draft-preparation-v1:viewer-s")!)
        .order,
    ).toEqual([]);
  });
  it("keeps absent ADP unavailable and provides expandable explanations", () => {
    render(<DraftPreparation data={data} leagueId="l" />);
    expect(
      screen.getByText("No grade is assigned when ADP is missing."),
    ).toBeTruthy();
    expect(screen.getByText("C").closest("tr")?.textContent).toContain("—");
    expect(
      screen.getAllByRole("button", { name: /About/ }).length,
    ).toBeGreaterThan(3);
  });
  it("filters candidates and connects a league-scoped what-if mock", () => {
    render(<DraftPreparation data={data} leagueId="l" />);
    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "unknown" },
    });
    expect(screen.getByText("No players match these filters.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /what-if mock/ }).getAttribute("href"),
    ).toBe("/mock-draft?leagueId=l&sport=NFL");
  });
  it("honors disabled custom ranking controls", () => {
    render(
      <DraftPreparation
        data={{ ...data, customRankingsEnabled: false }}
        leagueId="l"
      />,
    );
    expect(screen.queryByRole("button", { name: "Move down A" })).toBeNull();
  });
});
