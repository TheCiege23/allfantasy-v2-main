import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { saveDraftPlanningPreference } from "@/lib/core-app/draftPlanningActions";
vi.mock("@/components/i18n/LanguageProviderClient", () => ({
  useOptionalLanguage: () => ({ language: "en" }),
}));
vi.mock("@/lib/core-app/draftPlanningActions", () => ({ saveDraftPlanningPreference: vi.fn(async () => ({ ok: true })) }));
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
    playerId: "player-1",
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
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);
describe("draft preparation accessible controls", () => {
  it("preserves existing local planning preferences until the first explicit account save", () => {
    localStorage.setItem('af-draft-preparation-v1:viewer-s', JSON.stringify({ order: ['id:1', 'id:0'], spread: 'adp' }));
    const players = data.players.map((p, i) => ({ ...p, playerKey: `id:${i}` }));
    render(<DraftPreparation data={{ ...data, players, planningPreferenceState: 'ready', planningPreference: null }} leagueId="l" />);
    expect(screen.getAllByRole('row')[1].textContent).toContain('B');
    expect(screen.getByRole('status').textContent).toContain('Local copy');
    expect(saveDraftPlanningPreference).not.toHaveBeenCalled();
  });
  it("loads private account ordering and saves changes without touching the live queue", async () => {
    const players = data.players.map((p, i) => ({ ...p, playerKey: `id:${i}` }));
    render(<DraftPreparation data={{ ...data, players, planningPreferenceState: 'ready', planningPreference: { version: 1, order: ['id:1', 'id:0'], spread: 'adp' } }} leagueId="l" />);
    expect(screen.getAllByRole('row')[1].textContent).toContain('B');
    fireEvent.click(screen.getByRole('button', { name: 'Move up A' }));
    await waitFor(() => expect(saveDraftPlanningPreference).toHaveBeenCalledWith('l', 's', { version: 1, order: ['id:0', 'id:1'], spread: 'adp' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved to your account'));
  });
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
