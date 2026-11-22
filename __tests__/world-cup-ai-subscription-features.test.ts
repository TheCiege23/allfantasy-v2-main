import { describe, expect, it } from "vitest"
import {
  buildWorldCupPathToWinInsight,
  calculateWorldCupBracketGrade,
  calculateWorldCupLeaderboardAiInsights,
} from "@/lib/world-cup/worldCupAiSubscriptionInsights"
import {
  buildWorldCupGroupStageGroupInsights,
  buildWorldCupGroupStageThirdPlaceInsights,
} from "@/lib/world-cup/worldCupAiInsights"
import {
  buildWorldCupRootingGuide,
  type BuildWorldCupRootingGuideInput,
} from "@/lib/world-cup/worldCupRootingGuide"
import {
  buildWorldCupBracketUniquenessInsights,
} from "@/lib/world-cup/worldCupUniquenessInsights"
import {
  buildWorldCupAiBracketShareCard,
} from "@/lib/world-cup/worldCupAiShareCard"
import {
  buildWorldCupKnockoutDangerZones,
} from "@/lib/world-cup/worldCupKnockoutDangerZones"
import {
  buildWorldCupInviteMessage,
  buildWorldCupBracketShareMessage,
  buildWorldCupSocialCaptions,
  WORLD_CUP_SOCIAL_HASHTAGS,
} from "@/lib/world-cup/worldCupShareCopy"
import {
  buildWorldCupCommissionerChecklist,
} from "@/lib/world-cup/worldCupCommissionerChecklist"

const match = {
  id: "m1",
  apiFixtureId: null,
  round: "round_of_32" as const,
  roundIndex: 1,
  matchNumber: 1,
  homeSlotKey: "A1",
  awaySlotKey: "B2",
  homeTeamId: "brazil",
  awayTeamId: "canada",
  homeTeamName: "Brazil",
  awayTeamName: "Canada",
  homeTeamLogo: null,
  awayTeamLogo: null,
  homeScore: null,
  awayScore: null,
  homePenaltyScore: null,
  awayPenaltyScore: null,
  status: "scheduled" as const,
  startsAt: null,
  winnerTeamId: null,
  winnerTeamName: null,
  nextMatchId: null,
  nextMatchSlot: null,
  elapsedMinute: null,
  injuryTime: null,
  period: null,
  venueName: null,
  venueCity: null,
  apiStatusShort: null,
  lastScoreSyncedAt: null,
}

const baseCompletion = {
  challengeId: "c1",
  entryId: "e1",
  groupStageComplete: false,
  knockoutComplete: false,
  fullEntryComplete: false,
  groupsRankedCount: 6,
  missingGroups: ["A"],
  thirdPlaceSelectedCount: 3,
  missingKnockoutPicks: 2,
  requiredKnockoutPicks: 4,
  completedKnockoutPicks: 2,
  isLocked: false,
  isComplete: false,
  submittedAt: null,
}

describe("World Cup Chimmy subscription insights", () => {
  it("returns a completion-focused basic bracket grade for incomplete entries", () => {
    const grade = calculateWorldCupBracketGrade({
      completionReview: baseCompletion,
      entry: { championTeamId: null, championTeamName: null },
      matches: [match],
      picks: [],
    })

    expect(grade.completionPercent).toBeGreaterThan(0)
    expect(grade.grade).toBe("Needs Picks")
    expect(grade.championSelected).toBe(false)
    expect(grade.recommendation).toMatch(/third-place|knockout|group/i)
  })

  it("returns full risk and champion confidence details for complete entries", () => {
    const grade = calculateWorldCupBracketGrade({
      completionReview: {
        ...baseCompletion,
        groupStageComplete: true,
        knockoutComplete: true,
        fullEntryComplete: true,
        groupsRankedCount: 12,
        thirdPlaceSelectedCount: 8,
        missingKnockoutPicks: 0,
        completedKnockoutPicks: 4,
        isComplete: true,
        submittedAt: "2026-06-01T00:00:00.000Z",
      },
      entry: { championTeamId: "brazil", championTeamName: "Brazil", submittedAt: "2026-06-01T00:00:00.000Z" },
      matches: [match],
      picks: [{
        id: "p1",
        matchId: "m1",
        matchNumber: 1,
        round: "final",
        selectedTeamId: "brazil",
        selectedSlotKey: "A1",
        selectedTeamName: "Brazil",
        pointsAwarded: 0,
        isCorrect: null,
        lockedAt: null,
      }],
    })

    expect(grade.grade).toMatch(/^A/)
    expect(grade.riskLabel).toBe("Low")
    expect(grade.championConfidence).toBeGreaterThan(50)
    expect(grade.biggestRisk).toMatch(/chalk|leverage|path/i)
  })

  it("adds Chimmy win probability and health to finalized leaderboard rows without unfinalized data", () => {
    const insights = calculateWorldCupLeaderboardAiInsights([
      {
        rank: 1,
        entryId: "final-1",
        entryName: "Finalized 1",
        participantId: "p1",
        userId: "u1",
        username: null,
        avatarUrl: null,
        displayName: "User 1",
        totalScore: 0,
        maxPossibleScore: 480,
        correctPicks: 0,
        incorrectPicks: 0,
        championPickName: "Brazil",
        championTeamId: "brazil",
        championStillAlive: true,
        roundBreakdown: {},
        joinedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ])

    expect(insights).toHaveLength(1)
    expect(insights[0]).toMatchObject({ entryId: "final-1", championAlive: true })
    expect(insights[0].aiWinProbability).toBeGreaterThan(0)
  })

  it("returns a locked path-to-win teaser for non-Pro users", () => {
    const insight = buildWorldCupPathToWinInsight({
      selectedEntry: { id: "e1", name: "Mine", championTeamId: null, submittedAt: null },
      leaderboard: [],
      hasBracketBrainAi: false,
    })

    expect(insight.locked).toBe(true)
    expect(insight.lines.join(" ")).toMatch(/AF Pro can show your path to win/i)
  })

  it("uses only the current finalized entry and public leaderboard rows for path to win", () => {
    const insight = buildWorldCupPathToWinInsight({
      selectedEntry: {
        id: "e2",
        name: "Mine",
        championTeamId: "brazil",
        championTeamName: "Brazil",
        totalScore: 10,
        maxPossibleScore: 500,
        submittedAt: "2026-06-01T00:00:00.000Z",
      },
      leaderboard: [
        {
          rank: 1,
          entryId: "leader",
          entryName: "Leader",
          participantId: "p1",
          userId: "u1",
          username: null,
          avatarUrl: null,
          displayName: "Leader",
          totalScore: 20,
          maxPossibleScore: 450,
          correctPicks: 1,
          incorrectPicks: 0,
          championPickName: "France",
          championTeamId: "france",
          championStillAlive: true,
          roundBreakdown: {},
          joinedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          rank: 2,
          entryId: "e2",
          entryName: "Mine",
          participantId: "p2",
          userId: "u2",
          username: null,
          avatarUrl: null,
          displayName: "Me",
          totalScore: 10,
          maxPossibleScore: 500,
          correctPicks: 0,
          incorrectPicks: 0,
          championPickName: "Brazil",
          championTeamId: "brazil",
          championStillAlive: true,
          roundBreakdown: {},
          joinedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      hasBracketBrainAi: true,
    })

    expect(insight.locked).toBe(false)
    expect(insight.lines.join(" ")).toContain("10-point gap")
    expect(insight.lines.join(" ")).toContain("Some unfinalized entries are hidden until submitted.")
  })
})

describe("buildWorldCupGroupStageGroupInsights — deterministic per-group", () => {
  const teamsAlphabet = [
    { teamId: "t1", name: "Argentina", seedOrder: 1 },
    { teamId: "t2", name: "Brazil", seedOrder: 2 },
    { teamId: "t3", name: "Canada", seedOrder: 3 },
    { teamId: "t4", name: "Denmark", seedOrder: 4 },
  ]

  it("returns missing-picks guidance when group is incomplete", () => {
    const lines = buildWorldCupGroupStageGroupInsights({
      groupName: "Group D",
      groupKey: "D",
      teams: teamsAlphabet.slice(0, 3),
      order: ["t1", "t2"],
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/Group D still has unranked teams/i)
  })

  it("returns missing-picks guidance when fewer than 4 order entries", () => {
    const lines = buildWorldCupGroupStageGroupInsights({
      groupName: "Group A",
      groupKey: "A",
      teams: teamsAlphabet,
      order: ["t1", "t2", "t3"], // only 3 ranked
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/still has unranked teams/i)
  })

  it("produces safe/chalk insights when user picks match seeding exactly", () => {
    const lines = buildWorldCupGroupStageGroupInsights({
      groupName: "Group A",
      groupKey: "A",
      teams: teamsAlphabet,
      order: ["t1", "t2", "t3", "t4"], // 1→1, 2→2, 3→3, 4→4
    })
    const text = lines.join("\n")
    expect(text).toMatch(/Safest group winner/i)
    expect(text).toMatch(/Argentina/i)
    expect(text).toMatch(/Strategy: pure chalk/i)
  })

  it("flags a risky winner when user picks a low-seed team (seed #3 or #4) to win", () => {
    const lines = buildWorldCupGroupStageGroupInsights({
      groupName: "Group F",
      groupKey: "F",
      teams: teamsAlphabet,
      order: ["t3", "t2", "t1", "t4"], // user picks #3 seed as winner
    })
    const text = lines.join("\n")
    expect(text).toMatch(/Risky winner/i)
    expect(text).toMatch(/Canada/i)
    expect(text).toMatch(/higher-risk call/i)
  })

  it("flags high-variance when user ordering significantly inverts seeding", () => {
    const lines = buildWorldCupGroupStageGroupInsights({
      groupName: "Group B",
      groupKey: "B",
      teams: teamsAlphabet,
      order: ["t4", "t3", "t2", "t1"], // fully inverted from seeding
    })
    const text = lines.join("\n")
    expect(text).toMatch(/Risky winner|Strategy: high-variance/i)
  })

  it("never includes wagering or betting terms in produced lines", () => {
    const lines = buildWorldCupGroupStageGroupInsights({
      groupName: "Group A",
      groupKey: "A",
      teams: teamsAlphabet,
      order: ["t1", "t2", "t3", "t4"],
    })
    const text = lines.join(" ").toLowerCase()
    expect(text).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })
})

describe("buildWorldCupGroupStageThirdPlaceInsights — deterministic third-place pool", () => {
  const groups = [
    {
      id: "g-a", groupKey: "A", displayName: "Group A",
      teams: [
        { teamId: "a1", name: "Argentina", seedOrder: 1 },
        { teamId: "a2", name: "Brazil", seedOrder: 2 },
        { teamId: "a3", name: "Canada", seedOrder: 3 },
        { teamId: "a4", name: "Denmark", seedOrder: 4 },
      ],
    },
    {
      id: "g-b", groupKey: "B", displayName: "Group B",
      teams: [
        { teamId: "b1", name: "England", seedOrder: 1 },
        { teamId: "b2", name: "France", seedOrder: 2 },
        { teamId: "b3", name: "Germany", seedOrder: 3 },
        { teamId: "b4", name: "Honduras", seedOrder: 4 },
      ],
    },
  ]

  it("returns fallback when no third-place picks are selected", () => {
    const lines = buildWorldCupGroupStageThirdPlaceInsights({
      groups,
      thirdPlacePicks: [],
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/Select 8 third-place advancers/i)
  })

  it("shows progress message when partial selection (under required count)", () => {
    const lines = buildWorldCupGroupStageThirdPlaceInsights({
      groups,
      thirdPlacePicks: [
        { groupId: "g-a", teamId: "a3", isSelected: true },
        { groupId: "g-b", teamId: "b4", isSelected: true },
      ],
    })
    expect(lines[0]).toMatch(/Current selected: 2 of 8/)
    expect(lines[0]).toMatch(/6 more to lock in/i)
  })

  it("flags upside/volatility when most third-place picks are low-seed (>=3)", () => {
    const lines = buildWorldCupGroupStageThirdPlaceInsights({
      groups,
      thirdPlacePicks: [
        { groupId: "g-a", teamId: "a3", isSelected: true },
        { groupId: "g-a", teamId: "a4", isSelected: true },
        { groupId: "g-b", teamId: "b3", isSelected: true },
        { groupId: "g-b", teamId: "b4", isSelected: true },
      ],
      requiredCount: 4, // smaller required so 4 low-seed >= ceil(4/2)
    })
    const text = lines.join("\n")
    expect(text).toMatch(/lower-seed third-place teams/i)
    expect(text).toMatch(/upside but adds volatility/i)
  })

  it("flags safer advancement when most picks are top-seeded", () => {
    const lines = buildWorldCupGroupStageThirdPlaceInsights({
      groups,
      thirdPlacePicks: [
        { groupId: "g-a", teamId: "a1", isSelected: true },
        { groupId: "g-a", teamId: "a2", isSelected: true },
        { groupId: "g-b", teamId: "b1", isSelected: true },
        { groupId: "g-b", teamId: "b2", isSelected: true },
      ],
    })
    const text = lines.join("\n")
    expect(text).toMatch(/Strong third-place pool/i)
    expect(text).toMatch(/safer advancement odds/i)
  })

  it("produces differentiation message for a balanced pool", () => {
    const lines = buildWorldCupGroupStageThirdPlaceInsights({
      groups,
      thirdPlacePicks: [
        { groupId: "g-a", teamId: "a2", isSelected: true },
        { groupId: "g-b", teamId: "b3", isSelected: true },
      ],
    })
    const text = lines.join("\n")
    expect(text).toMatch(/differentiation if those groups break your way/i)
  })

  it("never includes wagering/betting terms", () => {
    const lines = buildWorldCupGroupStageThirdPlaceInsights({
      groups,
      thirdPlacePicks: [
        { groupId: "g-a", teamId: "a3", isSelected: true },
      ],
    })
    const text = lines.join(" ").toLowerCase()
    expect(text).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })
})

describe("Group Stage Chimmy insights — no external Chimmy dependencies", () => {
  it("helpers do not import OpenAI/XAI providers", async () => {
    // Static import-graph check: re-import the helper module fresh and confirm
    // the module source does not reference any AI provider client.
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const filePath = path.resolve(process.cwd(), "lib/world-cup/worldCupAiInsights.ts")
    const src = await fs.readFile(filePath, "utf-8")
    expect(src).not.toMatch(/OPENAI_API_KEY|XAI_API_KEY|new OpenAI|createOpenAI|openai\.com/i)
  })
})

describe("buildWorldCupRootingGuide — deterministic 'who to root for today'", () => {
  const baseEntry = {
    id: "entry-1",
    name: "My Bracket",
    championTeamId: "team-arg",
    championTeamName: "Argentina",
    isComplete: true,
  }

  function makeMatch(overrides: Record<string, unknown> = {}): any {
    return {
      id: "m1",
      apiFixtureId: null,
      round: "round_of_16",
      roundIndex: 2,
      matchNumber: 1,
      homeSlotKey: "A1",
      awaySlotKey: "B2",
      homeTeamId: "team-arg",
      awayTeamId: "team-den",
      homeTeamName: "Argentina",
      awayTeamName: "Denmark",
      homeTeamLogo: null,
      awayTeamLogo: null,
      homeScore: null,
      awayScore: null,
      homePenaltyScore: null,
      awayPenaltyScore: null,
      status: "scheduled",
      startsAt: "2026-06-15T18:00:00.000Z",
      winnerTeamId: null,
      winnerTeamName: null,
      nextMatchId: null,
      nextMatchSlot: null,
      elapsedMinute: null,
      injuryTime: null,
      period: null,
      venueName: null,
      venueCity: null,
      apiStatusShort: null,
      lastScoreSyncedAt: null,
      ...overrides,
    }
  }

  function makePick(overrides: Record<string, unknown> = {}): any {
    return {
      id: "pick-1",
      matchId: "m1",
      matchNumber: 1,
      round: "round_of_16",
      selectedTeamId: "team-arg",
      selectedSlotKey: "A1",
      selectedTeamName: "Argentina",
      confidencePoints: null,
      pointsAwarded: 0,
      isCorrect: null,
      lockedAt: null,
      ...overrides,
    }
  }

  const TODAY = new Date("2026-06-15T12:00:00.000Z")

  it("returns no_entry status when entry is null", () => {
    const result = buildWorldCupRootingGuide({
      entry: null,
      matches: [makeMatch()],
      picks: [],
      now: TODAY,
    } as BuildWorldCupRootingGuideInput)
    expect(result.status).toBe("no_entry")
    expect(result.recommendations).toHaveLength(0)
  })

  it("returns no_matches when no scheduled matches exist anywhere", () => {
    const result = buildWorldCupRootingGuide({
      entry: baseEntry,
      matches: [makeMatch({ status: "final", winnerTeamId: "team-arg" })],
      picks: [],
      now: TODAY,
    })
    expect(result.status).toBe("no_matches")
    expect(result.recommendations).toHaveLength(0)
  })

  it("champion pick playing today returns High impact + Champion path tag", () => {
    const result = buildWorldCupRootingGuide({
      entry: baseEntry,
      matches: [makeMatch()],
      picks: [],
      now: TODAY,
      hasBracketBrainAi: true,
    })
    expect(result.status).toBe("ready")
    expect(result.windowLabel).toBe("Today")
    expect(result.recommendations).toHaveLength(1)
    const rec = result.recommendations[0]
    expect(rec.impact).toBe("High")
    expect(rec.tag).toBe("Champion path")
    expect(rec.teamName).toBe("Argentina")
    expect(rec.reason).toMatch(/champion pick/i)
    expect(rec.reason).toMatch(/Denmark/)
  })

  it("knockout pick (no champion) returns Medium for R16, High for final/semi", () => {
    const r16 = buildWorldCupRootingGuide({
      entry: { ...baseEntry, championTeamId: "team-other", championTeamName: "Other" },
      matches: [makeMatch({ round: "round_of_16" })],
      picks: [makePick({ selectedTeamId: "team-arg" })],
      now: TODAY,
    })
    expect(r16.recommendations[0]?.impact).toBe("Medium")
    expect(r16.recommendations[0]?.tag).toBe("Knockout pick")

    const finalMatch = buildWorldCupRootingGuide({
      entry: { ...baseEntry, championTeamId: "team-other", championTeamName: "Other" },
      matches: [makeMatch({ id: "m-final", round: "final" })],
      picks: [makePick({ id: "pick-final", matchId: "m-final", round: "final", selectedTeamId: "team-arg" })],
      now: TODAY,
    })
    expect(finalMatch.recommendations[0]?.impact).toBe("High")

    const third = buildWorldCupRootingGuide({
      entry: { ...baseEntry, championTeamId: "team-other", championTeamName: "Other" },
      matches: [makeMatch({ id: "m-tp", round: "third_place" })],
      picks: [makePick({ id: "pick-tp", matchId: "m-tp", round: "third_place", selectedTeamId: "team-arg" })],
      now: TODAY,
    })
    expect(third.recommendations[0]?.impact).toBe("Low")
  })

  it("falls back to upcoming matches when nothing scheduled today", () => {
    const result = buildWorldCupRootingGuide({
      entry: baseEntry,
      matches: [
        makeMatch({ startsAt: "2026-06-20T18:00:00.000Z" }),
      ],
      picks: [],
      now: TODAY,
      hasBracketBrainAi: true,
    })
    expect(result.status).toBe("ready")
    expect(result.windowLabel).toBe("Upcoming matches")
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0]?.tag).toBe("Champion path")
  })

  it("limits Pro users to 3 recommendations, free users to 1", () => {
    const matches = [
      makeMatch({ id: "m1", round: "final" }), // champion pick → High
      makeMatch({ id: "m2", round: "semifinal", homeTeamId: "x1", awayTeamId: "x2", homeTeamName: "X1", awayTeamName: "X2" }),
      makeMatch({ id: "m3", round: "quarterfinal", homeTeamId: "y1", awayTeamId: "y2", homeTeamName: "Y1", awayTeamName: "Y2" }),
      makeMatch({ id: "m4", round: "round_of_16", homeTeamId: "z1", awayTeamId: "z2", homeTeamName: "Z1", awayTeamName: "Z2" }),
    ]
    const picks = [
      makePick({ id: "p2", matchId: "m2", round: "semifinal", selectedTeamId: "x1", selectedTeamName: "X1" }),
      makePick({ id: "p3", matchId: "m3", round: "quarterfinal", selectedTeamId: "y1", selectedTeamName: "Y1" }),
      makePick({ id: "p4", matchId: "m4", round: "round_of_16", selectedTeamId: "z1", selectedTeamName: "Z1" }),
    ]

    const pro = buildWorldCupRootingGuide({
      entry: baseEntry,
      matches,
      picks,
      now: TODAY,
      hasBracketBrainAi: true,
    })
    expect(pro.recommendations).toHaveLength(3)
    // High impact ones should come first.
    expect(pro.recommendations[0]?.impact).toBe("High")
    expect(pro.recommendations[1]?.impact).toBe("High")

    const free = buildWorldCupRootingGuide({
      entry: baseEntry,
      matches,
      picks,
      now: TODAY,
      hasBracketBrainAi: false,
    })
    expect(free.recommendations).toHaveLength(1)
    // Free users get the highest-impact rec only.
    expect(free.recommendations[0]?.impact).toBe("High")
    expect(free.lockedLines?.[0]).toMatch(/AF Pro unlocks/i)
  })

  it("returns incomplete status with helpful copy when picks don't intersect any match", () => {
    const result = buildWorldCupRootingGuide({
      entry: {
        ...baseEntry,
        championTeamId: null,
        championTeamName: null,
        isComplete: false,
      },
      matches: [makeMatch({ homeTeamId: "x1", awayTeamId: "x2", homeTeamName: "X", awayTeamName: "Y" })],
      picks: [],
      now: TODAY,
    })
    expect(result.status).toBe("incomplete")
    expect(result.recommendations).toHaveLength(0)
    expect(result.lockedLines?.[0]).toMatch(/Finish your group and knockout picks/i)
  })

  it("returns ready+empty with safe message when complete but no matches intersect picks", () => {
    const result = buildWorldCupRootingGuide({
      entry: {
        ...baseEntry,
        championTeamId: null,
        championTeamName: null,
        isComplete: true,
      },
      matches: [makeMatch({ homeTeamId: "x1", awayTeamId: "x2", homeTeamName: "X", awayTeamName: "Y" })],
      picks: [],
      now: TODAY,
    })
    expect(result.status).toBe("ready")
    expect(result.recommendations).toHaveLength(0)
    expect(result.lockedLines?.[0]).toMatch(/Check back on the next matchday/i)
  })

  it("deduplicates picks for the same match (champion takes priority over knockout pick)", () => {
    const result = buildWorldCupRootingGuide({
      entry: baseEntry,
      matches: [makeMatch()],
      // User picked champion to win this match AND that team is their champion.
      picks: [makePick({ selectedTeamId: "team-arg" })],
      now: TODAY,
      hasBracketBrainAi: true,
    })
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0]?.tag).toBe("Champion path")
  })

  it("ignores completed/cancelled/postponed matches", () => {
    const result = buildWorldCupRootingGuide({
      entry: baseEntry,
      matches: [
        makeMatch({ id: "m-final", status: "final" }),
        makeMatch({ id: "m-cancel", status: "cancelled" }),
        makeMatch({ id: "m-postpone", status: "postponed" }),
      ],
      picks: [],
      now: TODAY,
    })
    expect(result.status).toBe("no_matches")
  })

  it("uses default current time when 'now' is omitted (smoke check)", () => {
    const result = buildWorldCupRootingGuide({
      entry: baseEntry,
      matches: [makeMatch({ startsAt: new Date(Date.now() + 86400_000).toISOString() })],
      picks: [],
    })
    // With a tomorrow match and no `now`, we expect "Upcoming matches" status="ready".
    expect(result.status).toBe("ready")
    expect(result.windowLabel).toBe("Upcoming matches")
  })

  it("helper file does not import OpenAI/XAI providers (privacy guard)", async () => {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const filePath = path.resolve(process.cwd(), "lib/world-cup/worldCupRootingGuide.ts")
    const src = await fs.readFile(filePath, "utf-8")
    expect(src).not.toMatch(/OPENAI_API_KEY|XAI_API_KEY|new OpenAI|createOpenAI|openai\.com/i)
    expect(src).not.toMatch(/fetch\s*\(/i)
  })

  it("never includes wagering or betting language in recommendation reasons", () => {
    const result = buildWorldCupRootingGuide({
      entry: baseEntry,
      matches: [makeMatch()],
      picks: [makePick()],
      now: TODAY,
      hasBracketBrainAi: true,
    })
    const allText = result.recommendations.map((r) => r.reason).join(" ").toLowerCase()
    expect(allText).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })
})

describe("buildWorldCupBracketUniquenessInsights — deterministic pool comparison", () => {
  it("returns not_enough_pool_data when fewer than 3 finalized entries", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Argentina",
      ownPicksByRound: {},
      poolDistributions: { champion: [{ teamName: "Argentina", count: 1 }] },
      finalizedEntryCount: 2,
      hasBracketBrainAi: true,
    })
    expect(result.status).toBe("not_enough_pool_data")
    expect(result.insights).toHaveLength(0)
    expect(result.lockedLines?.[0]).toMatch(/Uniqueness unlocks/i)
  })

  it("returns incomplete when user has no champion and no knockout picks", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: null,
      ownPicksByRound: {},
      poolDistributions: { champion: [{ teamName: "Argentina", count: 5 }] },
      finalizedEntryCount: 10,
      hasBracketBrainAi: true,
    })
    expect(result.status).toBe("incomplete")
    expect(result.lockedLines?.[0]).toMatch(/Make group and knockout picks/i)
  })

  it("champion shared by 10% → very_rare", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Japan",
      ownPicksByRound: {},
      poolDistributions: {
        champion: [
          { teamName: "Argentina", count: 9 },
          { teamName: "Japan", count: 1 },
        ],
      },
      finalizedEntryCount: 10,
      hasBracketBrainAi: true,
    })
    expect(result.status).toBe("ready")
    const champ = result.insights.find((i) => i.tag === "Champion")
    expect(champ?.rarity).toBe("very_rare")
    expect(champ?.percentage).toBe(10)
    expect(champ?.description).toMatch(/contrarian/i)
  })

  it("champion shared by 50% → uncommon (boundary)", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Brazil",
      ownPicksByRound: {},
      poolDistributions: {
        champion: [
          { teamName: "Brazil", count: 5 },
          { teamName: "Argentina", count: 5 },
        ],
      },
      finalizedEntryCount: 10,
      hasBracketBrainAi: true,
    })
    const champ = result.insights.find((i) => i.tag === "Champion")
    expect(champ?.rarity).toBe("uncommon")
    expect(champ?.percentage).toBe(50)
  })

  it("champion shared by >50% → common (popular)", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Brazil",
      ownPicksByRound: {},
      poolDistributions: {
        champion: [{ teamName: "Brazil", count: 8 }, { teamName: "Argentina", count: 2 }],
      },
      finalizedEntryCount: 10,
      hasBracketBrainAi: true,
    })
    const champ = result.insights.find((i) => i.tag === "Champion")
    expect(champ?.rarity).toBe("common")
    expect(champ?.description).toMatch(/popular/i)
  })

  it("surfaces rare per-round knockout picks with correct tag", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Brazil",
      ownPicksByRound: {
        semifinal: ["Japan"], // 1/10 = 10% → very_rare
        round_of_16: ["Brazil"], // 8/10 = 80% → common (skipped)
      },
      poolDistributions: {
        champion: [{ teamName: "Brazil", count: 8 }, { teamName: "Argentina", count: 2 }],
        semifinal: [{ teamName: "Japan", count: 1 }, { teamName: "Brazil", count: 8 }],
        round_of_16: [{ teamName: "Brazil", count: 8 }],
      },
      finalizedEntryCount: 10,
      hasBracketBrainAi: true,
    })
    const semi = result.insights.find((i) => i.tag === "Semifinal")
    expect(semi).toBeDefined()
    expect(semi?.rarity).toBe("very_rare")
    expect(semi?.description).toMatch(/Japan/)
    expect(semi?.description).toMatch(/Semifinal/)
    // Common picks not surfaced as separate insights.
    const knockoutCommonShared = result.insights.find(
      (i) => i.tag === "Knockout" && i.rarity === "common"
    )
    expect(knockoutCommonShared).toBeUndefined()
  })

  it('returns "Chalk" fallback insight when nothing rare bubbles up', () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Brazil",
      ownPicksByRound: { semifinal: ["Brazil"] },
      poolDistributions: {
        champion: [{ teamName: "Brazil", count: 9 }, { teamName: "Argentina", count: 1 }],
        semifinal: [{ teamName: "Brazil", count: 9 }],
      },
      finalizedEntryCount: 10,
      hasBracketBrainAi: true,
    })
    // Champion is common but still surfaces; chalk fallback only fires when no insights at all.
    // Verify chalk only when truly empty.
    const onlyChalk = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: null,
      ownPicksByRound: { semifinal: ["Brazil"] },
      poolDistributions: {
        semifinal: [{ teamName: "Brazil", count: 9 }],
      },
      finalizedEntryCount: 10,
      hasBracketBrainAi: true,
    })
    const chalk = onlyChalk.insights.find((i) => i.tag === "Chalk")
    expect(chalk).toBeDefined()
    expect(chalk?.description).toMatch(/mostly|chalk|popular/i)
    // Above result still has at least the champion insight.
    expect(result.insights.length).toBeGreaterThan(0)
  })

  it("free user gets max 1 insight + lockedLines when more insights exist", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Japan",
      ownPicksByRound: {
        semifinal: ["South Korea"],
        quarterfinal: ["Morocco"],
      },
      poolDistributions: {
        champion: [{ teamName: "Japan", count: 1 }],
        semifinal: [{ teamName: "South Korea", count: 1 }],
        quarterfinal: [{ teamName: "Morocco", count: 1 }],
      },
      finalizedEntryCount: 10,
      hasBracketBrainAi: false,
    })
    expect(result.insights).toHaveLength(1)
    expect(result.lockedLines?.[0]).toMatch(/AF Pro unlocks/i)
    // Highest-rarity insight (very_rare) should be the one shown.
    expect(result.insights[0].rarity).toBe("very_rare")
  })

  it("Pro user gets up to 5 insights sorted by rarity", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Japan",
      ownPicksByRound: {
        final: ["Japan"],
        semifinal: ["South Korea"],
        quarterfinal: ["Morocco"],
        round_of_16: ["Wales"],
        round_of_32: ["Australia"],
      },
      poolDistributions: {
        champion: [{ teamName: "Japan", count: 1 }, { teamName: "Brazil", count: 9 }],
        final: [{ teamName: "Japan", count: 1 }],
        semifinal: [{ teamName: "South Korea", count: 2 }],
        quarterfinal: [{ teamName: "Morocco", count: 2 }],
        round_of_16: [{ teamName: "Wales", count: 2 }],
        round_of_32: [{ teamName: "Australia", count: 2 }],
      },
      finalizedEntryCount: 10,
      hasBracketBrainAi: true,
    })
    expect(result.insights.length).toBeLessThanOrEqual(5)
    expect(result.insights.length).toBeGreaterThan(0)
    // First insight has highest rarity score.
    const rarityScores = result.insights.map((i) =>
      i.rarity === "very_rare" ? 4 : i.rarity === "rare" ? 3 : i.rarity === "uncommon" ? 2 : 1
    )
    for (let i = 1; i < rarityScores.length; i++) {
      expect(rarityScores[i - 1]).toBeGreaterThanOrEqual(rarityScores[i])
    }
    // No locked line for Pro users when result fits within cap.
    expect(result.lockedLines).toBeUndefined()
  })

  it("respects custom minFinalizedEntries threshold", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Japan",
      ownPicksByRound: {},
      poolDistributions: { champion: [{ teamName: "Japan", count: 4 }] },
      finalizedEntryCount: 4,
      hasBracketBrainAi: true,
      minFinalizedEntries: 5,
    })
    expect(result.status).toBe("not_enough_pool_data")
  })

  it("never includes wagering/betting language in any insight description", () => {
    const result = buildWorldCupBracketUniquenessInsights({
      ownChampionTeamName: "Japan",
      ownPicksByRound: { final: ["Japan"], semifinal: ["South Korea"] },
      poolDistributions: {
        champion: [{ teamName: "Japan", count: 1 }, { teamName: "Brazil", count: 9 }],
        final: [{ teamName: "Japan", count: 1 }],
        semifinal: [{ teamName: "South Korea", count: 2 }],
      },
      finalizedEntryCount: 10,
      hasBracketBrainAi: true,
    })
    const all = result.insights.map((i) => i.description).join(" ").toLowerCase()
    expect(all).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })

  it("helper file does not import OpenAI/XAI providers or fetch (privacy guard)", async () => {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const filePath = path.resolve(process.cwd(), "lib/world-cup/worldCupUniquenessInsights.ts")
    const src = await fs.readFile(filePath, "utf-8")
    expect(src).not.toMatch(/OPENAI_API_KEY|XAI_API_KEY|new OpenAI|createOpenAI|openai\.com/i)
    expect(src).not.toMatch(/\bfetch\s*\(/i)
    expect(src).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
  })
})

describe("buildWorldCupAiBracketShareCard — composes 6 Chimmy signals", () => {
  const sampleGrade = {
    grade: "B+",
    completionPercent: 88,
    groupCompletionPercent: 100,
    thirdPlaceCompletionPercent: 100,
    knockoutCompletionPercent: 80,
    missingPickCount: 3,
    championSelected: true,
    championPick: "Argentina",
    riskLabel: "Medium" as const,
    upsetMeter: "Balanced" as const,
    championConfidence: 72,
    biggestRisk: "Round of 16 upset zone",
    recommendation: "Lock in your finalists before kickoff.",
  }

  const sampleRooting = {
    teamName: "Argentina",
    matchLabel: "Argentina vs Denmark — Round of 16",
    reason: "Champion alive.",
    impact: "High" as const,
    tag: "Champion path" as const,
    matchId: "m1",
    matchStartsAt: "2026-06-15T18:00:00.000Z",
  }

  const sampleUniqueness = {
    label: "Champion: Argentina",
    description: "Held by 12% of finalized brackets.",
    rarity: "rare" as const,
    percentage: 12,
    tag: "Champion" as const,
  }

  it("returns no_entry status when entryName is null", () => {
    const result = buildWorldCupAiBracketShareCard({
      poolName: "Office Cup",
      entryName: null,
      championName: null,
      isComplete: false,
      grade: null,
    })
    expect(result.status).toBe("no_entry")
    expect(result.lines).toHaveLength(0)
    expect(result.shareText).toMatch(/Select a bracket entry/i)
  })

  it("Free preview includes only base 5 lines + lock CTA, omits Pro signals", () => {
    const result = buildWorldCupAiBracketShareCard({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: "Argentina",
      isComplete: true,
      grade: sampleGrade,
      topRootingRec: sampleRooting,
      aiWinProbabilityPct: 18,
      topUniquenessInsight: sampleUniqueness,
      hasBracketBrainAi: false,
    })

    const text = result.shareText
    // Base lines present.
    expect(text).toContain("Office Cup")
    expect(text).toContain("Bracket 1")
    expect(text).toContain("Locked in")
    expect(text).toContain("Bracket Grade: B+")
    expect(text).toContain("Champion: Argentina")
    expect(text).toContain("Powered by AllFantasy.")
    // Pro-only signals NOT in the share text.
    expect(text).not.toContain("Champion Confidence")
    expect(text).not.toContain("Chimmy Win Probability")
    expect(text).not.toContain("Today: Root for")
    expect(text).not.toContain("Uniqueness:")
    // Lock CTA present.
    expect(result.lockedLines?.[0]).toMatch(/AF Pro unlocks/i)
  })

  it("Pro version includes all 6 Chimmy signals when all inputs are provided", () => {
    const result = buildWorldCupAiBracketShareCard({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: "Argentina",
      isComplete: true,
      grade: sampleGrade,
      topRootingRec: sampleRooting,
      aiWinProbabilityPct: 18,
      topUniquenessInsight: sampleUniqueness,
      hasBracketBrainAi: true,
    })

    const text = result.shareText
    expect(text).toContain("Office Cup")
    expect(text).toContain("Bracket 1 — Locked in")
    expect(text).toContain("Bracket Grade: B+ (88% complete, medium risk)")
    expect(text).toContain("Champion: Argentina")
    expect(text).toContain("Style:")
    expect(text).toContain("Champion Confidence: 72%")
    expect(text).toContain("Chimmy Win Probability: 18%")
    expect(text).toContain("Today: Root for Argentina")
    expect(text).toContain("Champion path")
    expect(text).toContain("High impact")
    expect(text).toContain("Uniqueness: Champion: Argentina (12% of finalized brackets)")
    expect(text).toContain("Powered by AllFantasy.")
    expect(result.lockedLines).toBeUndefined()
  })

  it("gracefully omits Pro-only signals that are missing/null without crashing", () => {
    const result = buildWorldCupAiBracketShareCard({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: null,
      isComplete: false,
      grade: { ...sampleGrade, championSelected: false, championConfidence: 0 },
      topRootingRec: null,
      aiWinProbabilityPct: null,
      topUniquenessInsight: null,
      hasBracketBrainAi: true,
    })

    expect(result.status).toBe("incomplete")
    // No champion confidence line when championSelected=false.
    expect(result.shareText).not.toContain("Champion Confidence:")
    // No AI Win Probability line when null.
    expect(result.shareText).not.toContain("Chimmy Win Probability")
    // No rooting/uniqueness lines when missing.
    expect(result.shareText).not.toContain("Today: Root for")
    expect(result.shareText).not.toContain("Uniqueness:")
    // Still ends with the Powered-by line.
    expect(result.shareText).toContain("Powered by AllFantasy.")
  })

  it("clamps Chimmy Win Probability into 0–100 range", () => {
    const lowProb = buildWorldCupAiBracketShareCard({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: "Argentina",
      isComplete: true,
      grade: sampleGrade,
      aiWinProbabilityPct: -50,
      hasBracketBrainAi: true,
    })
    expect(lowProb.shareText).toContain("Chimmy Win Probability: 0%")

    const highProb = buildWorldCupAiBracketShareCard({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: "Argentina",
      isComplete: true,
      grade: sampleGrade,
      aiWinProbabilityPct: 500,
      hasBracketBrainAi: true,
    })
    expect(highProb.shareText).toContain("Chimmy Win Probability: 100%")
  })

  it("sanitizes wagering/betting terms from every share line", () => {
    const result = buildWorldCupAiBracketShareCard({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: "Argentina",
      isComplete: true,
      grade: sampleGrade,
      topRootingRec: sampleRooting,
      aiWinProbabilityPct: 18,
      topUniquenessInsight: {
        label: "Champion: Argentina",
        description: "wagering favorite of sportsbook odds",
        rarity: "common",
        percentage: 12,
        tag: "Champion",
      },
      hasBracketBrainAi: true,
    })

    const text = result.shareText.toLowerCase()
    expect(text).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })

  it("share card never contains emails or user IDs", () => {
    const result = buildWorldCupAiBracketShareCard({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: "Argentina",
      isComplete: true,
      grade: sampleGrade,
      topRootingRec: sampleRooting,
      aiWinProbabilityPct: 18,
      topUniquenessInsight: sampleUniqueness,
      hasBracketBrainAi: true,
    })

    expect(result.shareText).not.toMatch(/@example\.com|owner@|user-1/i)
  })

  it("uses 'In progress' label for unsubmitted brackets", () => {
    const result = buildWorldCupAiBracketShareCard({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: "Argentina",
      isComplete: false,
      grade: sampleGrade,
      hasBracketBrainAi: false,
    })
    expect(result.shareText).toContain("Bracket 1 — In progress")
    expect(result.status).toBe("incomplete")
  })

  it("derives explain summary tone from grade riskLabel", () => {
    const high = buildWorldCupAiBracketShareCard({
      poolName: "P",
      entryName: "B",
      championName: "X",
      isComplete: true,
      grade: { ...sampleGrade, riskLabel: "High" },
      hasBracketBrainAi: false,
    })
    expect(high.shareText).toContain("high-variance bracket")

    const low = buildWorldCupAiBracketShareCard({
      poolName: "P",
      entryName: "B",
      championName: "X",
      isComplete: true,
      grade: { ...sampleGrade, riskLabel: "Low" },
      hasBracketBrainAi: false,
    })
    expect(low.shareText).toContain("chalky bracket")
  })

  it("helper file does not import OpenAI/XAI providers, fetch, or Prisma", async () => {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const filePath = path.resolve(process.cwd(), "lib/world-cup/worldCupAiShareCard.ts")
    const src = await fs.readFile(filePath, "utf-8")
    expect(src).not.toMatch(/OPENAI_API_KEY|XAI_API_KEY|new OpenAI|createOpenAI|openai\.com/i)
    expect(src).not.toMatch(/\bfetch\s*\(/i)
    expect(src).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
  })
})

describe("buildWorldCupKnockoutDangerZones — deterministic danger detection", () => {
  function makeMatch(overrides: Record<string, unknown> = {}): any {
    return {
      id: "m1",
      apiFixtureId: null,
      round: "round_of_16",
      roundIndex: 2,
      matchNumber: 1,
      homeSlotKey: "A1",
      awaySlotKey: "B2",
      homeTeamId: "team-arg",
      awayTeamId: "team-den",
      homeTeamName: "Argentina",
      awayTeamName: "Denmark",
      homeTeamLogo: null,
      awayTeamLogo: null,
      homeScore: null,
      awayScore: null,
      homePenaltyScore: null,
      awayPenaltyScore: null,
      status: "scheduled",
      startsAt: "2026-06-20T18:00:00.000Z",
      winnerTeamId: null,
      winnerTeamName: null,
      nextMatchId: null,
      nextMatchSlot: null,
      elapsedMinute: null,
      injuryTime: null,
      period: null,
      venueName: null,
      venueCity: null,
      apiStatusShort: null,
      lastScoreSyncedAt: null,
      ...overrides,
    }
  }

  function makePick(overrides: Record<string, unknown> = {}): any {
    return {
      id: "p1",
      matchId: "m1",
      matchNumber: 1,
      round: "round_of_16",
      selectedTeamId: "team-arg",
      selectedSlotKey: "A1",
      selectedTeamName: "Argentina",
      confidencePoints: null,
      pointsAwarded: 0,
      isCorrect: null,
      lockedAt: null,
      ...overrides,
    }
  }

  const baseEntry = {
    id: "e1",
    championTeamId: "team-arg",
    championTeamName: "Argentina",
  }

  it("returns no_entry status when entry is null", () => {
    const result = buildWorldCupKnockoutDangerZones({
      entry: null,
      picks: [makePick()],
      matches: [makeMatch()],
    })
    expect(result.status).toBe("no_entry")
    expect(result.zones).toHaveLength(0)
  })

  it("returns no_picks status with helpful copy when picks array is empty", () => {
    const result = buildWorldCupKnockoutDangerZones({
      entry: baseEntry,
      picks: [],
      matches: [makeMatch()],
    })
    expect(result.status).toBe("no_picks")
    expect(result.lockedLines?.[0]).toMatch(/Make knockout picks/i)
  })

  it("returns no_risks safe message when all picks look favored", () => {
    // Argentina pick @ slot A1 (strength 85), opponent at B4 (strength 40) -> delta = -45, no risk.
    const result = buildWorldCupKnockoutDangerZones({
      entry: baseEntry,
      picks: [makePick()],
      matches: [makeMatch({ awaySlotKey: "B4" })],
    })
    expect(result.status).toBe("no_risks")
    expect(result.lockedLines?.[0]).toMatch(/No danger zones/i)
  })

  it("flags champion as eliminated when champion's match is final and they lost", () => {
    const result = buildWorldCupKnockoutDangerZones({
      entry: baseEntry,
      picks: [makePick()],
      matches: [
        makeMatch({
          id: "m-champion",
          round: "round_of_16",
          status: "final",
          winnerTeamId: "team-den",
          homeTeamId: "team-arg",
          awayTeamId: "team-den",
        }),
      ],
      hasBracketBrainAi: true,
    })
    const champZone = result.zones.find((z) => z.tag === "Already eliminated")
    expect(champZone).toBeDefined()
    expect(champZone?.severity).toBe("High")
    expect(champZone?.description).toMatch(/champion bonus/i)
  })

  it("flags a knockout pick as eliminated when its match is final and the pick lost", () => {
    const result = buildWorldCupKnockoutDangerZones({
      entry: { ...baseEntry, championTeamId: null, championTeamName: null },
      picks: [
        makePick({
          id: "p-r16",
          matchId: "m-r16",
          selectedTeamId: "team-brazil",
          selectedTeamName: "Brazil",
        }),
      ],
      matches: [
        makeMatch({
          id: "m-r16",
          status: "final",
          winnerTeamId: "team-other",
          homeTeamId: "team-brazil",
          awayTeamId: "team-other",
          awayTeamName: "Other",
        }),
      ],
      hasBracketBrainAi: true,
    })
    const zone = result.zones[0]
    expect(zone).toBeDefined()
    expect(zone.tag).toBe("Already eliminated")
    expect(zone.severity).toBe("High")
    expect(zone.description).toMatch(/Brazil was eliminated/i)
  })

  it("flags live matches involving the user's picks as High severity", () => {
    const result = buildWorldCupKnockoutDangerZones({
      entry: { ...baseEntry, championTeamId: null },
      picks: [makePick()],
      matches: [makeMatch({ status: "live" })],
      hasBracketBrainAi: true,
    })
    expect(result.zones[0]?.tag).toBe("Live now")
    expect(result.zones[0]?.severity).toBe("High")
    expect(result.zones[0]?.description).toMatch(/playing Denmark right now/i)
  })

  it("flags scheduled match where opponent is significantly stronger as High danger", () => {
    // Pick team-c4 (slot C4, strength 38), opponent team-d1 (slot D1, strength 88) -> delta = +50
    const result = buildWorldCupKnockoutDangerZones({
      entry: { ...baseEntry, championTeamId: null },
      picks: [
        makePick({
          matchId: "m-risky",
          selectedTeamId: "team-c4",
          selectedSlotKey: "C4",
          selectedTeamName: "Underdog",
        }),
      ],
      matches: [
        makeMatch({
          id: "m-risky",
          homeSlotKey: "C4",
          awaySlotKey: "D1",
          homeTeamId: "team-c4",
          awayTeamId: "team-d1",
          homeTeamName: "Underdog",
          awayTeamName: "Favorite",
        }),
      ],
      hasBracketBrainAi: true,
    })
    expect(result.zones[0]?.severity).toBe("High")
    expect(result.zones[0]?.tag).toBe("Knockout pick")
    expect(result.zones[0]?.strengthDelta).toBeGreaterThanOrEqual(15)
  })

  it("uses Champion path tag for semifinal/final picks", () => {
    const result = buildWorldCupKnockoutDangerZones({
      entry: { ...baseEntry, championTeamId: null },
      picks: [
        makePick({
          matchId: "m-final",
          round: "final",
          selectedTeamId: "team-c4",
          selectedSlotKey: "C4",
          selectedTeamName: "Underdog",
        }),
      ],
      matches: [
        makeMatch({
          id: "m-final",
          round: "final",
          homeSlotKey: "C4",
          awaySlotKey: "D1",
          homeTeamId: "team-c4",
          awayTeamId: "team-d1",
          homeTeamName: "Underdog",
          awayTeamName: "Favorite",
        }),
      ],
      hasBracketBrainAi: true,
    })
    expect(result.zones[0]?.tag).toBe("Champion path")
  })

  it("dedupes one zone per match (keeps highest severity per match)", () => {
    // Same match could match multiple rules — only one zone should result.
    const result = buildWorldCupKnockoutDangerZones({
      entry: baseEntry,
      picks: [makePick()],
      matches: [
        makeMatch({
          status: "final",
          winnerTeamId: "team-den",
          homeTeamId: "team-arg",
          awayTeamId: "team-den",
        }),
      ],
      hasBracketBrainAi: true,
    })
    // Should produce only ONE zone (champion eliminated takes priority).
    const zonesForMatch = result.zones.filter((z) => z.matchId === "m1")
    expect(zonesForMatch.length).toBeLessThanOrEqual(1)
  })

  it("sorts zones by severity desc, then by round priority (later rounds first)", () => {
    const result = buildWorldCupKnockoutDangerZones({
      entry: { ...baseEntry, championTeamId: null },
      picks: [
        makePick({
          id: "p-r32",
          matchId: "m-r32",
          round: "round_of_32",
          selectedTeamId: "team-r32",
          selectedSlotKey: "A4",
          selectedTeamName: "Picky32",
        }),
        makePick({
          id: "p-final",
          matchId: "m-final",
          round: "final",
          selectedTeamId: "team-final",
          selectedSlotKey: "B4",
          selectedTeamName: "PickyF",
        }),
      ],
      matches: [
        makeMatch({
          id: "m-r32",
          round: "round_of_32",
          homeSlotKey: "A4",
          awaySlotKey: "C1",
          homeTeamId: "team-r32",
          awayTeamId: "team-c1",
          awayTeamName: "OppR32",
        }),
        makeMatch({
          id: "m-final",
          round: "final",
          homeSlotKey: "B4",
          awaySlotKey: "F1",
          homeTeamId: "team-final",
          awayTeamId: "team-f1",
          awayTeamName: "OppFinal",
        }),
      ],
      hasBracketBrainAi: true,
    })
    expect(result.zones.length).toBeGreaterThan(0)
    // Final round should come first (higher round priority within same severity).
    expect(result.zones[0]?.round).toBe("final")
  })

  it("limits Pro users to 5 zones, free users to 1 with a locked CTA", () => {
    const picks = Array.from({ length: 6 }, (_, i) =>
      makePick({
        id: `p-${i}`,
        matchId: `m-${i}`,
        selectedTeamId: `team-${i}`,
        selectedSlotKey: "A4",
        selectedTeamName: `Pick${i}`,
      })
    )
    const matches = Array.from({ length: 6 }, (_, i) =>
      makeMatch({
        id: `m-${i}`,
        homeSlotKey: "A4",
        awaySlotKey: "D1",
        homeTeamId: `team-${i}`,
        awayTeamId: `opp-${i}`,
        homeTeamName: `Pick${i}`,
        awayTeamName: `Opp${i}`,
      })
    )

    const pro = buildWorldCupKnockoutDangerZones({
      entry: { ...baseEntry, championTeamId: null },
      picks,
      matches,
      hasBracketBrainAi: true,
    })
    expect(pro.zones.length).toBeLessThanOrEqual(5)

    const free = buildWorldCupKnockoutDangerZones({
      entry: { ...baseEntry, championTeamId: null },
      picks,
      matches,
      hasBracketBrainAi: false,
    })
    expect(free.zones).toHaveLength(1)
    expect(free.lockedLines?.[0]).toMatch(/AF Pro unlocks/i)
  })

  it("never includes wagering or betting language in zone descriptions", () => {
    const result = buildWorldCupKnockoutDangerZones({
      entry: baseEntry,
      picks: [makePick({ selectedSlotKey: "C4", selectedTeamId: "team-c4" })],
      matches: [
        makeMatch({
          homeSlotKey: "C4",
          awaySlotKey: "D1",
          homeTeamId: "team-c4",
          awayTeamId: "team-d1",
        }),
      ],
      hasBracketBrainAi: true,
    })
    const allText = result.zones.map((z) => z.description).join(" ").toLowerCase()
    expect(allText).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })

  it("helper file does not import OpenAI/XAI providers, fetch, or Prisma", async () => {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const filePath = path.resolve(process.cwd(), "lib/world-cup/worldCupKnockoutDangerZones.ts")
    const src = await fs.readFile(filePath, "utf-8")
    expect(src).not.toMatch(/OPENAI_API_KEY|XAI_API_KEY|new OpenAI|createOpenAI|openai\.com/i)
    expect(src).not.toMatch(/\bfetch\s*\(/i)
    expect(src).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
  })
})

describe("buildWorldCupInviteMessage — commissioner Copy Invite Message", () => {
  it("returns ready commissioner message with invite link, code, and deadline", () => {
    const result = buildWorldCupInviteMessage({
      poolName: "Office Cup",
      inviteUrl: "https://allfantasy.ai/join/bracket/WC8F3KM67Y",
      inviteCode: "WC8F3KM67Y",
      lockDeadlineLabel: "June 11, 2026 3:00 PM ET",
      audience: "commissioner",
    })
    expect(result.status).toBe("ready")
    expect(result.message).toContain("Office Cup")
    expect(result.message).toContain("WC8F3KM67Y")
    expect(result.message).toContain("https://allfantasy.ai/join/bracket/WC8F3KM67Y")
    expect(result.message).toContain("June 11, 2026 3:00 PM ET")
    expect(result.message).toContain("Chimmy Bracket Report")
    expect(result.message).toContain("Powered by AllFantasy.")
  })

  it("omits deadline + code when not provided", () => {
    const result = buildWorldCupInviteMessage({
      poolName: "Office Cup",
      inviteUrl: "https://allfantasy.ai/join/bracket/X",
      audience: "commissioner",
    })
    expect(result.status).toBe("ready")
    expect(result.message).not.toMatch(/Invite code:/i)
    expect(result.message).not.toMatch(/Picks lock/i)
    expect(result.message).toContain("Powered by AllFantasy.")
  })

  it("member audience never exposes invite link or code", () => {
    const result = buildWorldCupInviteMessage({
      poolName: "Office Cup",
      inviteUrl: "https://allfantasy.ai/join/bracket/SECRET",
      inviteCode: "SECRET-CODE",
      lockDeadlineLabel: "June 11, 2026",
      audience: "member",
    })
    expect(result.status).toBe("member_blocked")
    expect(result.message).not.toContain("SECRET")
    expect(result.message).not.toContain("SECRET-CODE")
    expect(result.message).not.toContain("https://")
    expect(result.message).toMatch(/Ask the pool commissioner/i)
  })

  it("never includes wagering or betting language", () => {
    const result = buildWorldCupInviteMessage({
      poolName: "Office Cup",
      inviteUrl: "https://allfantasy.ai/join/bracket/X",
      inviteCode: "X",
      audience: "commissioner",
    })
    expect(result.message.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })
})

describe("buildWorldCupBracketShareMessage — finalized bracket share", () => {
  it("uses prebuilt Chimmy Share Card text when provided", () => {
    const result = buildWorldCupBracketShareMessage({
      poolName: "Office Cup",
      prebuiltShareText: "My Chimmy Share Card Output\nLine 2\nPowered by AllFantasy.",
      isComplete: true,
    })
    expect(result.status).toBe("ready")
    expect(result.message).toContain("My Chimmy Share Card Output")
    expect(result.message).toContain("Line 2")
  })

  it("builds deterministic fallback from grade + champion when no prebuilt text", () => {
    const result = buildWorldCupBracketShareMessage({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: "Argentina",
      gradeLabel: "A-",
      isComplete: true,
      poolUrl: "https://allfantasy.ai/brackets/world-cup/c1",
    })
    expect(result.status).toBe("ready")
    expect(result.message).toContain("Office Cup")
    expect(result.message).toContain("Bracket 1 — locked in")
    expect(result.message).toContain("Argentina")
    expect(result.message).toContain("Bracket Grade: A-")
    expect(result.message).toContain("Think you can beat my bracket?")
    expect(result.message).toContain("https://allfantasy.ai/brackets/world-cup/c1")
    expect(result.message).toContain("Powered by AllFantasy.")
  })

  it("uses 'in progress' label and softer CTA when not finalized", () => {
    const result = buildWorldCupBracketShareMessage({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      isComplete: false,
    })
    expect(result.status).toBe("incomplete")
    expect(result.message).toContain("Bracket 1 — in progress")
    expect(result.message).toMatch(/Make your picks before lock/i)
  })

  it("gracefully omits optional fields without crashing", () => {
    const result = buildWorldCupBracketShareMessage({
      poolName: "Office Cup",
      isComplete: true,
    })
    expect(result.message).toContain("Office Cup")
    expect(result.message).not.toContain("Champion pick:")
    expect(result.message).not.toContain("Bracket Grade:")
  })

  it("never includes wagering or betting language", () => {
    const result = buildWorldCupBracketShareMessage({
      poolName: "Office Cup",
      championName: "Argentina",
      gradeLabel: "A",
      isComplete: true,
    })
    expect(result.message.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })
})

describe("buildWorldCupSocialCaptions — platform-friendly deterministic captions", () => {
  it("returns captions for twitter, instagram, and discord with required hashtag block", () => {
    const captions = buildWorldCupSocialCaptions({
      poolName: "Office Cup",
      entryName: "Bracket 1",
      championName: "Argentina",
      gradeLabel: "A-",
      isComplete: true,
      poolUrl: "https://allfantasy.ai/brackets/world-cup/c1",
    })
    expect(captions.twitter).toContain(WORLD_CUP_SOCIAL_HASHTAGS)
    expect(captions.instagram).toContain(WORLD_CUP_SOCIAL_HASHTAGS)
    expect(captions.discord).toContain(WORLD_CUP_SOCIAL_HASHTAGS)
  })

  it("twitter caption stays within 280 chars including hashtags", () => {
    const captions = buildWorldCupSocialCaptions({
      poolName: "A very very very very very very long pool name for a stress test",
      championName: "Argentina",
      gradeLabel: "A+",
      isComplete: true,
      poolUrl: "https://allfantasy.ai/brackets/world-cup/c1xxxxxxxxxxxxxxxxxxxxxxxx",
    })
    expect(captions.twitter.length).toBeLessThanOrEqual(280)
  })

  it("all three captions mention the pool name and AllFantasy branding", () => {
    const captions = buildWorldCupSocialCaptions({
      poolName: "Office Cup",
      championName: "Argentina",
      gradeLabel: "A-",
      isComplete: true,
    })
    for (const text of [captions.twitter, captions.instagram, captions.discord]) {
      expect(text).toMatch(/Office Cup|AllFantasy/i)
    }
  })

  it("required hashtag block contains the exact 7 user-required hashtags", () => {
    expect(WORLD_CUP_SOCIAL_HASHTAGS).toContain("#fantasyfootball")
    expect(WORLD_CUP_SOCIAL_HASHTAGS).toContain("#NFL")
    expect(WORLD_CUP_SOCIAL_HASHTAGS).toContain("#football")
    expect(WORLD_CUP_SOCIAL_HASHTAGS).toContain("#fantasyfootballadvice")
    expect(WORLD_CUP_SOCIAL_HASHTAGS).toContain("#sports")
    expect(WORLD_CUP_SOCIAL_HASHTAGS).toContain("#nflnews")
    expect(WORLD_CUP_SOCIAL_HASHTAGS).toContain("#fantasyfootballdraft")
  })

  it("never includes wagering or betting language across any caption", () => {
    const captions = buildWorldCupSocialCaptions({
      poolName: "Office Cup",
      championName: "Argentina",
      gradeLabel: "A-",
      isComplete: true,
      poolUrl: "https://allfantasy.ai/brackets/world-cup/c1",
    })
    for (const text of [captions.twitter, captions.instagram, captions.discord]) {
      expect(text.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
    }
  })

  it("helper file does not import OpenAI/XAI providers, fetch, or Prisma (privacy guard)", async () => {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const filePath = path.resolve(process.cwd(), "lib/world-cup/worldCupShareCopy.ts")
    const src = await fs.readFile(filePath, "utf-8")
    expect(src).not.toMatch(/OPENAI_API_KEY|XAI_API_KEY|new OpenAI|createOpenAI|openai\.com/i)
    expect(src).not.toMatch(/\bfetch\s*\(/i)
    expect(src).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
  })
})

describe("buildWorldCupCommissionerChecklist — pool completion checklist", () => {
  function makeSnapshot(overrides: Partial<any> = {}): any {
    return {
      totalEntries: 0,
      completedBracketCount: 0,
      incompleteBracketCount: 0,
      totalMissingPicks: 0,
      maxEntriesPerParticipant: 5,
      lockCountdownMs: null,
      effectiveLockAt: null,
      isLocked: false,
      mostPopularChampion: null,
      mostUniqueLean: null,
      usersMaxedEntries: 0,
      biggestUpsetLean: null,
      usersWithIncompleteBrackets: [],
      entriesMissingPicks: [],
      ...overrides,
    }
  }

  it("non-commissioner viewer returns no_data status with safe fallback (no link/code)", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: makeSnapshot({ totalEntries: 5, completedBracketCount: 2 }),
      poolName: "Office Cup",
      poolUrl: "https://allfantasy.ai/brackets/world-cup/c1",
      isCommissioner: false,
    })
    expect(result.status).toBe("no_data")
    expect(result.rows).toHaveLength(0)
    expect(result.reminderMessage).toMatch(/Ask the pool commissioner/i)
    expect(result.reminderMessage).not.toContain("https://allfantasy.ai/brackets/world-cup/c1")
    expect(result.emptyLines?.[0]).toMatch(/Only the pool commissioner/i)
  })

  it("returns no_data when snapshot is null but provides safe reminder copy", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: null,
      poolName: "Office Cup",
      poolUrl: "https://allfantasy.ai/brackets/world-cup/c1",
      lockDeadlineLabel: "June 11, 2026 3:00 PM ET",
      isCommissioner: true,
    })
    expect(result.status).toBe("no_data")
    expect(result.reminderMessage).toContain("Office Cup")
    expect(result.reminderMessage).toContain("June 11, 2026 3:00 PM ET")
    expect(result.reminderMessage).toContain("https://allfantasy.ai/brackets/world-cup/c1")
    expect(result.reminderMessage).toContain("Powered by AllFantasy.")
  })

  it("no_members status when pool exists but no entries created yet", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: makeSnapshot({ totalEntries: 0 }),
      poolName: "Office Cup",
      isCommissioner: true,
    })
    expect(result.status).toBe("no_members")
    expect(result.summary.totalEntries).toBe(0)
    expect(result.emptyLines?.[0]).toMatch(/No members/i)
  })

  it("all finalized → 100% complete, single aggregated Finalized row", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: makeSnapshot({
        totalEntries: 4,
        completedBracketCount: 4,
        incompleteBracketCount: 0,
      }),
      poolName: "Office Cup",
      poolUrl: "https://allfantasy.ai/brackets/world-cup/c1",
      isCommissioner: true,
    })
    expect(result.status).toBe("ready")
    expect(result.summary.totalEntries).toBe(4)
    expect(result.summary.finalized).toBe(4)
    expect(result.summary.inProgress).toBe(0)
    expect(result.summary.percentComplete).toBe(100)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].status).toBe("Finalized")
    expect(result.rows[0].entryName).toMatch(/4 finalized brackets/i)
  })

  it("none finalized → 0% with incomplete rows", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: makeSnapshot({
        totalEntries: 3,
        completedBracketCount: 0,
        incompleteBracketCount: 3,
        entriesMissingPicks: [
          { entryId: "e1", entryName: "Bracket 1", missingPicks: 2, userId: "u1" },
          { entryId: "e2", entryName: "Bracket 2", missingPicks: 8, userId: "u2" },
          { entryId: "e3", entryName: "Bracket 3", missingPicks: 5, userId: "u3" },
        ],
        usersWithIncompleteBrackets: [
          { userId: "u1", displayName: "Alice", incompleteEntryCount: 1, missingPicks: 2 },
          { userId: "u2", displayName: "Bob", incompleteEntryCount: 1, missingPicks: 8 },
          { userId: "u3", displayName: "Charlie", incompleteEntryCount: 1, missingPicks: 5 },
        ],
      }),
      poolName: "Office Cup",
      isCommissioner: true,
    })
    expect(result.status).toBe("ready")
    expect(result.summary.percentComplete).toBe(0)
    expect(result.summary.finalized).toBe(0)
    expect(result.summary.inProgress).toBe(3)
    expect(result.rows).toHaveLength(3)
    // Each row has a status, missingPicks, and a display name from the lookup.
    const statuses = result.rows.map((r) => r.status)
    expect(statuses).toContain("In progress") // missingPicks <= 3
    expect(statuses).toContain("Needs picks") // missingPicks > 3
    expect(result.rows.map((r) => r.displayName)).toEqual(
      expect.arrayContaining(["Alice", "Bob", "Charlie"])
    )
  })

  it("mixed status: 2 finalized + 2 in progress = 50%, both shown", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: makeSnapshot({
        totalEntries: 4,
        completedBracketCount: 2,
        incompleteBracketCount: 2,
        entriesMissingPicks: [
          { entryId: "e1", entryName: "Bracket 3", missingPicks: 1, userId: "u3" },
          { entryId: "e2", entryName: "Bracket 4", missingPicks: 6, userId: "u4" },
        ],
        usersWithIncompleteBrackets: [
          { userId: "u3", displayName: "Charlie", incompleteEntryCount: 1, missingPicks: 1 },
          { userId: "u4", displayName: "Dawn", incompleteEntryCount: 1, missingPicks: 6 },
        ],
      }),
      poolName: "Office Cup",
      isCommissioner: true,
    })
    expect(result.summary.percentComplete).toBe(50)
    expect(result.rows).toHaveLength(3) // 1 aggregated finalized + 2 incomplete
    expect(result.rows[0].status).toBe("Finalized")
  })

  it("missing/empty/unsafe display names fall back to 'Member'", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: makeSnapshot({
        totalEntries: 3,
        incompleteBracketCount: 3,
        entriesMissingPicks: [
          { entryId: "e1", entryName: "B1", missingPicks: 1, userId: "u1" },
          { entryId: "e2", entryName: "B2", missingPicks: 1, userId: "u2" },
          { entryId: "e3", entryName: "B3", missingPicks: 1, userId: "u3" },
        ],
        usersWithIncompleteBrackets: [
          { userId: "u1", displayName: null, incompleteEntryCount: 1, missingPicks: 1 },
          { userId: "u2", displayName: "owner@example.com", incompleteEntryCount: 1, missingPicks: 1 },
          { userId: "u3", displayName: "user-abc123def", incompleteEntryCount: 1, missingPicks: 1 },
        ],
      }),
      poolName: "Office Cup",
      isCommissioner: true,
    })
    // null, email-shaped, and userId-shaped names all collapse to "Member"
    expect(result.rows.map((r) => r.displayName)).toEqual(["Member", "Member", "Member"])
  })

  it("reminder copy never leaks emails, user IDs, or invite codes", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: makeSnapshot({
        totalEntries: 2,
        completedBracketCount: 1,
        incompleteBracketCount: 1,
        entriesMissingPicks: [
          { entryId: "e1", entryName: "B1", missingPicks: 1, userId: "user-1" },
        ],
        usersWithIncompleteBrackets: [
          { userId: "user-1", displayName: "owner@example.com", incompleteEntryCount: 1, missingPicks: 1 },
        ],
      }),
      poolName: "Office Cup",
      poolUrl: "https://allfantasy.ai/brackets/world-cup/c1",
      lockDeadlineLabel: "June 11, 2026 3:00 PM ET",
      isCommissioner: true,
    })
    expect(result.reminderMessage).toContain("Office Cup")
    expect(result.reminderMessage).toContain("https://allfantasy.ai/brackets/world-cup/c1")
    expect(result.reminderMessage).toContain("June 11, 2026")
    expect(result.reminderMessage).not.toMatch(/owner@example\.com/i)
    expect(result.reminderMessage).not.toMatch(/\buser-1\b/i)
    expect(result.reminderMessage).not.toMatch(/INVITE-?CODE|inviteCode|WC[0-9A-Z]{6,}/i)
  })

  it("percent calculation: 7 of 10 finalized = 70%", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: makeSnapshot({
        totalEntries: 10,
        completedBracketCount: 7,
        incompleteBracketCount: 3,
      }),
      poolName: "Office Cup",
      isCommissioner: true,
    })
    expect(result.summary.percentComplete).toBe(70)
  })

  it("never includes wagering or betting language in reminder copy", () => {
    const result = buildWorldCupCommissionerChecklist({
      snapshot: makeSnapshot({ totalEntries: 5, completedBracketCount: 2, incompleteBracketCount: 3 }),
      poolName: "Office Cup",
      isCommissioner: true,
    })
    expect(result.reminderMessage.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })

  it("helper file does not import OpenAI/XAI providers, fetch, or Prisma (privacy guard)", async () => {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const filePath = path.resolve(process.cwd(), "lib/world-cup/worldCupCommissionerChecklist.ts")
    const src = await fs.readFile(filePath, "utf-8")
    expect(src).not.toMatch(/OPENAI_API_KEY|XAI_API_KEY|new OpenAI|createOpenAI|openai\.com/i)
    expect(src).not.toMatch(/\bfetch\s*\(/i)
    expect(src).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
  })
})

