import { describe, expect, it } from "vitest"
import { DEFAULT_WORLD_CUP_SCORING } from "@/lib/world-cup/worldCupBracketBuilder"
import type { WorldCupChimmyContext } from "@/lib/world-cup/worldCupChimmyContext"
import { tryDeterministicWorldCupChimmyReply } from "@/lib/world-cup/worldCupChimmyReplyPolicy"

function context(overrides: Partial<WorldCupChimmyContext> = {}): WorldCupChimmyContext {
  return {
    challengeId: "wc-1",
    poolName: "Office Cup",
    isLocked: false,
    lockReason: null,
    participantCount: 8,
    entryCount: 8,
    finalizedEntryCount: 6,
    inviteCount: 3,
    scoring: { ...DEFAULT_WORLD_CUP_SCORING },
    userRole: "participant",
    commissionerSettings: null,
    entry: {
      entryId: "e1",
      entryName: "My Bracket",
      championPick: "Brazil",
      totalScore: 120,
      maxPossibleScore: 380,
      rank: 2,
      correctPicks: 8,
      incorrectPicks: 1,
      isComplete: false,
      isLocked: false,
      groupPicks: [],
      knockoutPicks: [],
      thirdPlacePicks: [],
    },
    liveMatches: [],
    upcomingMatches: [
      {
        matchId: "official:brazil-japan",
        round: "group_stage",
        homeTeamName: "Brazil",
        awayTeamName: "Japan",
        homeScore: null,
        awayScore: null,
        homePenaltyScore: null,
        awayPenaltyScore: null,
        winnerTeamName: null,
        status: "scheduled",
        minute: null,
        injuryTime: null,
        startsAt: "2026-06-15T20:00:00.000Z",
        venueName: null,
        venueCity: null,
        apiStatusShort: "NS",
        lastSyncedAt: "2026-06-05T12:00:00.000Z",
      },
    ],
    recentMatches: [],
    groupStandings: [],
    leaderboard: [
      {
        rank: 1,
        entryId: "leader",
        entryName: "Leader",
        userId: "u0",
        totalScore: 140,
        maxPossibleScore: 400,
        championPickName: "Spain",
      },
      {
        rank: 2,
        entryId: "e1",
        entryName: "My Bracket",
        userId: "u1",
        totalScore: 120,
        maxPossibleScore: 380,
        championPickName: "Brazil",
      },
    ],
    liveDataStatus: "fixture_only",
    lastSyncedAt: "2026-06-05T12:00:00.000Z",
    locale: "en",
    fetchedAt: "2026-06-05T13:00:00.000Z",
    ...overrides,
  }
}

describe("World Cup Chimmy deterministic intents", () => {
  it("answers user's current points from the saved entry", () => {
    const reply = tryDeterministicWorldCupChimmyReply({
      prompt: "How many points do I have?",
      context: context(),
      locale: "en",
    })

    expect(reply).toContain("120 pts")
    expect(reply).toContain("Max possible")
    expect(reply).toContain("Confidence:")
  })

  it("answers champion pick from the saved entry", () => {
    const reply = tryDeterministicWorldCupChimmyReply({
      prompt: "Show my champion pick",
      context: context(),
      locale: "en",
    })

    expect(reply).toContain("Brazil")
    expect(reply).toContain("My Bracket")
  })

  it("answers team schedule only from cached fixture data", () => {
    const reply = tryDeterministicWorldCupChimmyReply({
      prompt: "Who does Brazil play next?",
      context: context(),
      locale: "en",
      /*
       * The clock the fixtures were captured at (synced 2026-06-05, kickoff 2026-06-15). Without it the
       * reply judged "upcoming" against the real date, and this test began failing once 06-15 passed.
       */
      now: new Date("2026-06-05T13:00:00.000Z"),
    })

    expect(reply).toContain("Brazil fixture from cache")
    expect(reply).toContain("Brazil vs Japan")
    expect(reply).toContain("2026")
  })

  it("refuses team schedule when cache is missing", () => {
    const reply = tryDeterministicWorldCupChimmyReply({
      prompt: "Who does Brazil play next?",
      context: context({ upcomingMatches: [], recentMatches: [], liveMatches: [], liveDataStatus: "unavailable", lastSyncedAt: null }),
      locale: "en",
    })

    expect(reply).toContain("I don't have reliable data for that yet")
    expect(reply).toContain("cached fixture schedule")
  })

  it("refuses unsupported current facts without inventing injuries or odds", () => {
    const reply = tryDeterministicWorldCupChimmyReply({
      prompt: "Who is injured and what are the odds?",
      context: context(),
      locale: "en",
    })

    expect(reply).toContain("I don't have reliable data for that yet")
    expect(reply).not.toMatch(/\b\d{1,2}-\d{1,2}\b/)
  })

  it("answers stable soccer knowledge with a current-data disclosure", () => {
    const reply = tryDeterministicWorldCupChimmyReply({
      prompt: "What is a false nine?",
      context: context(),
      locale: "en",
    })

    expect(reply).toContain("stable soccer knowledge")
    expect(reply).toContain("false nine")
    expect(reply).not.toContain("fresh squad, form, or injury data loaded here")
  })

  it("answers current-team danger as general principles when fresh data is absent", () => {
    const reply = tryDeterministicWorldCupChimmyReply({
      prompt: "Why is Morocco dangerous?",
      context: context(),
      locale: "en",
    })

    expect(reply).toContain("general soccer principles")
    expect(reply).toContain("I do not have fresh squad, form, or injury data loaded here")
  })
})
