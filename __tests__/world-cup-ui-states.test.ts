import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import {
  getBracketBlockReason,
  mapJoinError,
  formatWorldCupPlaceholder,
} from "@/lib/world-cup/worldCupBracketUtils"
import {
  getFlagUrlForCountryCode,
  normalizeWorldCupTeamSeedRow,
  validateTeamSeedRow,
} from "@/lib/world-cup/worldCupSeedData"
import { buildWorldCupDemoRoundOf32Fixtures } from "@/lib/world-cup/worldCupTestFixtures"
import { isWorldCupChallengeLocked, isWorldCupMatchLocked } from "@/lib/world-cup/worldCupBracketBuilder"
import {
  assertWorldCupPickPayloadReady,
  buildWorldCupMatchesFromGroupPredictions,
  buildWorldCupProjectedMatches,
  countRemainingPicks,
  findWorldCupPickForMatch,
  findFirstUnpickedMatch,
  getInvalidDownstreamPickIds,
  getOrderedRounds,
  getWorldCupPickMatchMethod,
  getWorldCupGuidedPicksState,
  getWorldCupProjectedMatchTeams,
  getWorldCupUnpickableReason,
  hasWorldCupPickSelection,
  isBracketComplete,
  isWorldCupMatchPickable,
} from "@/lib/world-cup/worldCupProjectedBracket"
import type { WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"

function makeProjectionGroup(groupKey: string, teams: Array<{ id: string; name: string }>) {
  return {
    id: `group-${groupKey}`,
    groupKey,
    teams: teams.map((team) => ({ teamId: team.id, name: team.name, logoUrl: null })),
  }
}

function makeCompleteGroupStageProjection(overrides: {
  groupAWinner?: { id: string; name: string }
  groupBRunnerUp?: { id: string; name: string }
  thirdPlaceTeam?: { id: string; name: string; groupKey?: string }
} = {}) {
  const groupAWinner = overrides.groupAWinner ?? { id: "team-a1", name: "Mexico" }
  const groupBRunnerUp = overrides.groupBRunnerUp ?? { id: "team-b2", name: "Canada" }
  const thirdPlaceTeam = overrides.thirdPlaceTeam ?? { id: "team-c3", name: "Morocco", groupKey: "C" }
  const groups = "ABCDEFGHIJKL".split("").map((groupKey) => {
    const winner = groupKey === "A" ? groupAWinner : { id: `team-${groupKey.toLowerCase()}1`, name: `Team ${groupKey}1` }
    const runnerUp = groupKey === "B" ? groupBRunnerUp : { id: `team-${groupKey.toLowerCase()}2`, name: `Team ${groupKey}2` }
    const third = groupKey === (thirdPlaceTeam.groupKey ?? "C") ? thirdPlaceTeam : { id: `team-${groupKey.toLowerCase()}3`, name: `Team ${groupKey}3` }
    return makeProjectionGroup(groupKey, [
      winner,
      runnerUp,
      third,
      { id: `team-${groupKey.toLowerCase()}4`, name: `Team ${groupKey}4` },
    ])
  })
  return {
    groups,
    groupRankingPicks: groups.flatMap((group) =>
      group.teams.map((team, index) => ({
        groupId: group.id,
        teamId: team.teamId,
        predictedRank: index + 1,
      }))
    ),
    thirdPlaceAdvancerPicks: groups.slice(0, 8).map((group) => {
      const team = group.groupKey === (thirdPlaceTeam.groupKey ?? "C")
        ? thirdPlaceTeam
        : { id: group.teams[2]?.teamId ?? `team-${group.groupKey.toLowerCase()}3` }
      return {
        groupId: group.id,
        teamId: team.id,
        isSelected: true,
      }
    }),
    completion: {
      allGroupsRanked: true,
      thirdPlaceComplete: true,
      groupStageComplete: true,
    },
  }
}

function makeMatch(overrides: Partial<WorldCupMatchView> = {}): WorldCupMatchView {
  return {
    id: "m1",
    apiFixtureId: null,
    round: "round_of_32",
    roundIndex: 1,
    matchNumber: 1,
    homeSlotKey: "A1",
    awaySlotKey: "B2",
    homeTeamId: "team-a",
    awayTeamId: "team-b",
    homeTeamName: "Argentina",
    awayTeamName: "Brazil",
    homeTeamLogo: null,
    awayTeamLogo: null,
    homeScore: null,
    awayScore: null,
    homePenaltyScore: null,
    awayPenaltyScore: null,
    status: "scheduled",
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
    ...overrides,
  }
}

function makePick(overrides: Partial<WorldCupPickView> = {}): WorldCupPickView {
  return {
    id: "p1",
    matchId: "m1",
    round: "round_of_32",
    selectedTeamId: "team-a",
    selectedSlotKey: "A1",
    selectedTeamName: "Argentina",
    pointsAwarded: 0,
    isCorrect: null,
    lockedAt: null,
    ...overrides,
  }
}

describe("formatWorldCupPlaceholder", () => {
  it("formats group winner slots", () => {
    expect(formatWorldCupPlaceholder("A1", "TBD", null)).toBe("Winner Group A")
    expect(formatWorldCupPlaceholder("H1", "TBD", null)).toBe("Winner Group H")
  })

  it("formats group runner-up slots", () => {
    expect(formatWorldCupPlaceholder("B2", "TBD", null)).toBe("Runner-up Group B")
    expect(formatWorldCupPlaceholder("D2", "TBD", null)).toBe("Runner-up Group D")
  })

  it("formats best-3rd-place slot", () => {
    expect(formatWorldCupPlaceholder("A3", "TBD", null)).toBe("Best 3rd Place")
  })

  it("formats TBD qualifier slots", () => {
    expect(formatWorldCupPlaceholder("TBD2", "TBD", null)).toBe("TBD Qualifier 2")
    expect(formatWorldCupPlaceholder("TBD10", "TBD", null)).toBe("TBD Qualifier 10")
  })

  it("formats match winner slots", () => {
    expect(formatWorldCupPlaceholder("W-M5", "TBD", null)).toBe("Winner Match 5")
  })

  it("formats match loser slots", () => {
    expect(formatWorldCupPlaceholder("L-M3", "TBD", null)).toBe("Loser Match 3")
  })

  it("returns the teamName as-is when a real team is set", () => {
    expect(formatWorldCupPlaceholder("A1", "Brazil", 10)).toBe("Brazil")
  })

  it("falls back to TBD for unrecognised slot keys", () => {
    expect(formatWorldCupPlaceholder("UNKNOWN", "TBD", null)).toBe("TBD")
  })
})

describe("World Cup team and fixture seed readiness", () => {
  it("normalizes team seed rows with code, flag, group, seed, and ranking metadata", () => {
    const normalized = normalizeWorldCupTeamSeedRow({
      countryName: "United States",
      abbreviation: "USA",
      countryCode: "us",
      displayName: "USA",
      flagEmoji: "🇺🇸",
      group: "D",
      seed: 9,
      ranking: 11,
    })

    expect(validateTeamSeedRow({ countryName: "USA", fifaCode: "USA", groupName: "D", seed: 9 }).ok).toBe(true)
    expect(normalized).toMatchObject({
      fifaCode: "USA",
      countryName: "USA",
      displayName: "USA",
      flagUrl: "https://flagcdn.com/w80/us.png",
      flagEmoji: "🇺🇸",
      groupName: "D",
      seed: 9,
      ranking: 11,
    })
  })

  it("builds flag asset URLs from FIFA codes used by the bracket", () => {
    expect(getFlagUrlForCountryCode("ENG")).toBe("https://flagcdn.com/w80/gb-eng.png")
    expect(getFlagUrlForCountryCode("ARG")).toBe("https://flagcdn.com/w80/ar.png")
  })

  it("mock fixture seed creates pickable round-of-32 matchups with teams, dates, and venues", () => {
    const matches = Array.from({ length: 31 }, (_, idx) =>
      makeMatch({
        id: `m-${idx + 1}`,
        matchNumber: idx + 1,
        round: idx < 16 ? "round_of_32" : "round_of_16",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "TBD",
        awayTeamName: "TBD",
        startsAt: null,
      })
    )
    const patches = buildWorldCupDemoRoundOf32Fixtures(matches)
    const patched = matches.map((match) => {
      const patch = patches.find((row) => row.matchId === match.id)
      return patch ? { ...match, ...patch.data } : match
    })

    expect(patches).toHaveLength(16)
    expect(patches[0].home).toMatchObject({ name: "Brazil", fifaCode: "BRA", groupName: "A", seed: 1 })
    expect(patches[0].data.venueName).toBeTruthy()
    expect(patches[0].data.startsAt).toBeInstanceOf(Date)
    expect(patched.filter(isWorldCupMatchPickable)).toHaveLength(16)
    expect(patched.filter((match) => !match.homeTeamId || !match.awayTeamId)).toHaveLength(15)
  })
})

describe("getBracketBlockReason", () => {
  it("returns ended message for final status", () => {
    expect(
      getBracketBlockReason({
        inviteCode: "INV1",
        challengeId: "wc1",
        name: "Challenge",
        ownerName: "Owner",
        seasonYear: 2026,
        participantCount: 3,
        status: "final",
      })
    ).toBe("This bracket challenge has ended.")
  })

  it("returns locked message for locked status", () => {
    expect(
      getBracketBlockReason({
        inviteCode: "INV1",
        challengeId: "wc1",
        name: "Challenge",
        ownerName: "Owner",
        seasonYear: 2026,
        participantCount: 3,
        status: "locked",
      })
    ).toBe("This bracket is locked — picks are no longer accepted.")
  })

  it("returns null for open status", () => {
    expect(
      getBracketBlockReason({
        inviteCode: "INV1",
        challengeId: "wc1",
        name: "Challenge",
        ownerName: "Owner",
        seasonYear: 2026,
        participantCount: 3,
        status: "open",
      })
    ).toBeNull()
  })
})

describe("mapJoinError", () => {
  it("maps duplicate participant error", () => {
    expect(mapJoinError("duplicate participant")).toBe("You have already joined this bracket.")
  })

  it("maps locked error", () => {
    expect(mapJoinError("locked")).toBe("This bracket is locked — picks are no longer accepted.")
  })

  it("maps full error", () => {
    expect(mapJoinError("challenge is full")).toBe("This bracket is full.")
  })

  it("returns a generic fallback for unknown errors", () => {
    const result = mapJoinError("some unexpected error")
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })
})

describe("World Cup pick readiness guards", () => {
  it("treats a bracket as unlocked before the challenge lock time", () => {
    const lock = isWorldCupChallengeLocked({
      challenge: {
        pickLockStrategy: "tournament_start",
        pickLockAt: "2026-07-01T16:00:00Z",
        status: "open",
      },
      now: new Date("2026-07-01T15:59:59Z"),
    })

    expect(lock.locked).toBe(false)
  })

  it("treats a bracket as locked when current time reaches lockAt", () => {
    const lock = isWorldCupChallengeLocked({
      challenge: {
        pickLockStrategy: "per_match",
        pickLockAt: "2026-07-01T16:00:00Z",
        status: "open",
      },
      now: new Date("2026-07-01T16:00:00Z"),
    })

    expect(lock.locked).toBe(true)
    expect(lock.reason).toBe("tournament_started")
  })

  it("does not globally lock test mode from stale seeded fixture kickoff times", () => {
    const lock = isWorldCupChallengeLocked({
      challenge: {
        pickLockStrategy: "tournament_start",
        pickLockAt: null,
        status: "open",
        isTestMode: true,
      },
      matches: [
        {
          startsAt: "2020-01-01T00:00:00Z",
          status: "scheduled",
          apiStatusShort: "TEST",
        },
      ],
      now: new Date("2026-07-01T16:00:00Z"),
    })

    expect(lock.locked).toBe(false)
    expect(lock.lockAt).toBeNull()
  })

  it("still locks test mode when explicit lockAt has passed", () => {
    const lock = isWorldCupChallengeLocked({
      challenge: {
        pickLockStrategy: "tournament_start",
        pickLockAt: "2026-07-01T15:00:00Z",
        status: "open",
        isTestMode: true,
      },
      matches: [
        {
          startsAt: "2020-01-01T00:00:00Z",
          status: "scheduled",
          apiStatusShort: "TEST",
        },
      ],
      now: new Date("2026-07-01T16:00:00Z"),
    })

    expect(lock.locked).toBe(true)
    expect(lock.reason).toBe("tournament_started")
  })

  it("keeps official per-match lock behavior after kickoff in non-test contests", () => {
    const locked = isWorldCupMatchLocked({
      challenge: {
        pickLockStrategy: "per_match",
        pickLockAt: null,
        status: "open",
      },
      match: {
        startsAt: "2026-07-01T12:00:00Z",
        status: "scheduled",
        apiStatusShort: null,
      },
      now: new Date("2026-07-01T12:00:01Z"),
    })

    expect(locked).toBe(true)
  })

  it("does not lock test/sim projected matches from stale SIM/TEST kickoff metadata", () => {
    const locked = isWorldCupMatchLocked({
      challenge: {
        pickLockStrategy: "per_match",
        pickLockAt: null,
        status: "open",
        isTestMode: true,
      },
      match: {
        startsAt: "2020-01-01T00:00:00Z",
        status: "scheduled",
        apiStatusShort: "SIM",
      },
      now: new Date("2026-07-01T12:00:01Z"),
    })

    expect(locked).toBe(false)
  })

  it("does not seed pick rows during entry creation", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/world-cup/worldCupBracketService.ts"),
      "utf8"
    )
    const createEntrySource = source.slice(
      source.indexOf("export async function createWorldCupBracketEntry"),
      source.indexOf("export async function renameWorldCupBracketEntry")
    )

    expect(createEntrySource).not.toMatch(/worldCupBracketPick\.(create|createMany|upsert)/)
  })

  it("treats a new bracket as 0 completed picks", () => {
    const matches = [makeMatch()]
    const picks: WorldCupPickView[] = []

    expect(picks.filter(hasWorldCupPickSelection).length).toBe(0)
    expect(countRemainingPicks(matches, picks)).toBe(1)
    expect(isBracketComplete(matches, picks)).toBe(false)
  })

  it("does not count placeholder pick rows as completed picks", () => {
    const matches = [makeMatch()]
    const placeholderPick = makePick({
      selectedTeamId: null,
      selectedSlotKey: null,
      selectedTeamName: "TBD",
    })

    expect(hasWorldCupPickSelection(placeholderPick)).toBe(false)
    expect(countRemainingPicks(matches, [placeholderPick])).toBe(1)
    expect(isBracketComplete(matches, [placeholderPick])).toBe(false)
  })

  it("starts the guided picker at the first pickable unpicked matchup", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1 }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Germany",
        homeSlotKey: "C1",
        awaySlotKey: "D2",
      }),
    ]
    const orderedRounds = getOrderedRounds(matches)

    expect(
      findFirstUnpickedMatch(
        matches,
        [makePick({ selectedTeamId: null, selectedSlotKey: null })],
        orderedRounds
      )?.id
    ).toBe("m1")

    expect(
      findFirstUnpickedMatch(
        matches,
        [makePick({ matchId: "m1", selectedTeamId: "team-a", selectedSlotKey: "A1" })],
        orderedRounds
      )?.id
    ).toBe("m2")
  })

  it("does not mark a bracket complete until real selections exist", () => {
    const matches = [makeMatch()]

    expect(
      isBracketComplete(matches, [
        makePick({ selectedTeamId: null, selectedSlotKey: null }),
      ])
    ).toBe(false)

    expect(
      isBracketComplete(matches, [
        makePick({ selectedTeamId: null, selectedSlotKey: "A1" }),
      ])
    ).toBe(true)
  })

  it("clears downstream picks from the selected entry pick list only", () => {
    const finalMatch = makeMatch({
      id: "m3",
      round: "round_of_16",
      roundIndex: 2,
      matchNumber: 3,
      homeSlotKey: "W-M1",
      awaySlotKey: "W-M2",
      homeTeamId: "team-a",
      awayTeamId: "team-c",
      homeTeamName: "Argentina",
      awayTeamName: "France",
    })
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m3", nextMatchSlot: "home" }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D2",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Germany",
        nextMatchId: "m3",
        nextMatchSlot: "away",
      }),
      finalMatch,
    ]
    const selectedEntryPicks = [
      makePick({ id: "entry-1-r32", matchId: "m1", selectedTeamId: "team-a" }),
      makePick({
        id: "entry-1-downstream",
        matchId: "m3",
        round: "round_of_16",
        selectedTeamId: "team-a",
        selectedSlotKey: "W-M1",
      }),
    ]
    const otherEntryPicks = [
      makePick({ id: "entry-2-r32", matchId: "m1", selectedTeamId: "team-b", selectedSlotKey: "B2" }),
      makePick({
        id: "entry-2-downstream",
        matchId: "m3",
        round: "round_of_16",
        selectedTeamId: "team-c",
        selectedSlotKey: "W-M2",
      }),
    ]

    expect(getInvalidDownstreamPickIds(matches, selectedEntryPicks, "m1", "team-b")).toEqual([
      "entry-1-downstream",
    ])
    expect(getInvalidDownstreamPickIds(matches, otherEntryPicks, "m1", "team-b")).toEqual([])
  })

  it("returns fixtures_not_synced when matches are empty", () => {
    expect(getWorldCupGuidedPicksState([])).toBe("fixtures_not_synced")
  })

  it("returns fixtures_not_ready when matches exist without real team IDs", () => {
    const unresolved = [
      makeMatch({
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "A1",
        awayTeamName: "B2",
      }),
    ]
    expect(getWorldCupGuidedPicksState(unresolved)).toBe("fixtures_not_ready")
  })

  it("returns ready when at least one pickable match exists", () => {
    expect(getWorldCupGuidedPicksState([makeMatch()])).toBe("ready")
  })

  it("moves from fixtures_not_ready to ready when first-round matches get team IDs", () => {
    const unresolvedFirstRound = Array.from({ length: 16 }, (_, idx) =>
      makeMatch({
        id: `m-${idx + 1}`,
        matchNumber: idx + 1,
        round: "round_of_32",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: `A${idx + 1}`,
        awayTeamName: `B${idx + 1}`,
      })
    )
    expect(getWorldCupGuidedPicksState(unresolvedFirstRound)).toBe("fixtures_not_ready")

    const resolvedFirstRound = unresolvedFirstRound.map((match, idx) => ({
      ...match,
      homeTeamId: `demo-home-${idx + 1}`,
      awayTeamId: `demo-away-${idx + 1}`,
      homeTeamName: `Home ${idx + 1}`,
      awayTeamName: `Away ${idx + 1}`,
    }))

    const pickableCount = resolvedFirstRound.filter((m) => isWorldCupMatchPickable(m)).length
    expect(pickableCount).toBe(16)
    expect(getWorldCupGuidedPicksState(resolvedFirstRound)).toBe("ready")
  })

  it("generates Round of 32 winners and runners-up from the user's group predictions", () => {
    const matches = [
      makeMatch({
        id: "m1",
        matchNumber: 1,
        homeSlotKey: "A1",
        awaySlotKey: "B2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Group A Winner",
        awayTeamName: "Group B Runner-up",
      }),
    ]

    const result = buildWorldCupMatchesFromGroupPredictions({
      matches,
      groupStageView: makeCompleteGroupStageProjection({
        groupAWinner: { id: "u1-a1", name: "Mexico" },
        groupBRunnerUp: { id: "u1-b2", name: "Canada" },
      }),
      bestThirdMappingConfirmed: false,
    })

    expect(result.matches[0]).toMatchObject({
      homeTeamId: "u1-a1",
      homeTeamName: "Mexico",
      awayTeamId: "u1-b2",
      awayTeamName: "Canada",
    })
    expect(isWorldCupMatchPickable(result.matches[0])).toBe(true)
  })

  it("keeps per-user generated brackets separate for different group predictions", () => {
    const matches = [
      makeMatch({
        id: "m1",
        matchNumber: 1,
        homeSlotKey: "A1",
        awaySlotKey: "B2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Group A Winner",
        awayTeamName: "Group B Runner-up",
      }),
    ]

    const userOne = buildWorldCupMatchesFromGroupPredictions({
      matches,
      groupStageView: makeCompleteGroupStageProjection({
        groupAWinner: { id: "user-one-a1", name: "Mexico" },
      }),
    }).matches[0]
    const userTwo = buildWorldCupMatchesFromGroupPredictions({
      matches,
      groupStageView: makeCompleteGroupStageProjection({
        groupAWinner: { id: "user-two-a1", name: "South Korea" },
      }),
    }).matches[0]

    expect(userOne.homeTeamName).toBe("Mexico")
    expect(userTwo.homeTeamName).toBe("South Korea")
    expect(userOne.homeTeamId).not.toBe(userTwo.homeTeamId)
  })

  it("uses selected third-place teams in provisional slots while mapping is gated", () => {
    const matches = [
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D3",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Group C Winner",
        awayTeamName: "Best 3rd Place Team 1",
      }),
    ]

    const result = buildWorldCupMatchesFromGroupPredictions({
      matches,
      groupStageView: makeCompleteGroupStageProjection({
        thirdPlaceTeam: { id: "team-b3", name: "Morocco", groupKey: "B" },
      }),
      bestThirdMappingConfirmed: false,
    })

    expect(result.status).toBe("best_third_mapping_unconfirmed")
    expect(result.matches[0].awayTeamId).toBe("team-b3")
    expect(result.matches[0].awayTeamName).toBe("Morocco")
  })

  it("shows an incomplete bracket state when group predictions are missing", () => {
    const result = buildWorldCupMatchesFromGroupPredictions({
      matches: [makeMatch({ homeTeamId: null, awayTeamId: null, homeTeamName: "Group A Winner", awayTeamName: "Group B Runner-up" })],
      groupStageView: {
        ...makeCompleteGroupStageProjection(),
        groupRankingPicks: [],
        completion: { allGroupsRanked: false, thirdPlaceComplete: false, groupStageComplete: false },
      },
    })

    expect(result.status).toBe("missing_rankings")
    expect(isWorldCupMatchPickable(result.matches[0])).toBe(false)
  })

  it("reports missing_home_team reason for unresolved home team", () => {
    const match = makeMatch({ homeTeamId: null })
    expect(getWorldCupUnpickableReason(match)).toBe("missing_home_team")
    expect(isWorldCupMatchPickable(match)).toBe(false)
  })

  it("reports missing_away_team reason for unresolved away team", () => {
    const match = makeMatch({ awayTeamId: null })
    expect(getWorldCupUnpickableReason(match)).toBe("missing_away_team")
    expect(isWorldCupMatchPickable(match)).toBe(false)
  })

  it("throws clear guided save error when selectedTeamId is missing", () => {
    expect(() =>
      assertWorldCupPickPayloadReady({
        selectedTeamId: null,
      })
    ).toThrow("This matchup is not ready for picks yet.")
  })

  it("allows a slot-key selection to count as a real guided pick", () => {
    expect(() =>
      assertWorldCupPickPayloadReady({
        selectedTeamId: null,
        selectedSlotKey: "W-M1",
      })
    ).not.toThrow()
  })

  it("rehydrates saved picks as completed selections after refresh", () => {
    const matches = [makeMatch()]
    const savedPicks = [makePick()]

    expect(savedPicks.filter(hasWorldCupPickSelection)).toHaveLength(1)
    expect(countRemainingPicks(matches, savedPicks)).toBe(0)
  })

  it("rehydrates projected next-round winners from saved picks after refresh", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m3", nextMatchSlot: "home" }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D2",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Japan",
        nextMatchId: "m3",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m3",
        round: "round_of_16",
        roundIndex: 2,
        matchNumber: 3,
        homeSlotKey: "W-M1",
        awaySlotKey: "W-M2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "TBD",
        awayTeamName: "TBD",
      }),
    ]
    const savedPicks = [
      makePick({ id: "p-m1", matchId: "m1", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m2", matchId: "m2", selectedTeamId: "team-d", selectedSlotKey: "D2", selectedTeamName: "Japan" }),
    ]

    const projected = buildWorldCupProjectedMatches(matches, savedPicks)
    const nextRound = projected.find((match) => match.id === "m3")

    expect(nextRound?.homeTeamName).toBe("Argentina")
    expect(nextRound?.awayTeamName).toBe("Japan")
    expect(isWorldCupMatchPickable(nextRound!)).toBe(true)
  })

  it("turns completed Round of 32 picks into pickable Round of 16 projected matchups", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m17", nextMatchSlot: "home" }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D2",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Germany",
        nextMatchId: "m17",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m17",
        round: "round_of_16",
        roundIndex: 2,
        matchNumber: 17,
        homeSlotKey: "W-M1",
        awaySlotKey: "W-M2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 1",
        awayTeamName: "Winner Match 2",
        status: "final",
        homeScore: 2,
        awayScore: 1,
        winnerTeamName: "Best 3rd Place Team 1",
        apiStatusShort: "SIM",
      }),
    ]
    const savedPicks = [
      makePick({ id: "p-m1", matchId: "m1", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m2", matchId: "m2", selectedTeamId: "team-d", selectedSlotKey: "D2", selectedTeamName: "Germany" }),
    ]

    const projected = buildWorldCupProjectedMatches(matches, savedPicks)
    const roundOf16 = projected.find((match) => match.id === "m17")

    expect(roundOf16).toMatchObject({
      homeTeamId: "team-a",
      awayTeamId: "team-d",
      homeTeamName: "Argentina",
      awayTeamName: "Germany",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      winnerTeamId: null,
      winnerTeamName: null,
      apiStatusShort: null,
    })
    expect(isWorldCupMatchPickable(roundOf16!)).toBe(true)
    expect(findFirstUnpickedMatch(projected, savedPicks, getOrderedRounds(projected))?.id).toBe("m17")
  })

  it("keeps official final state when a real fixture result exists", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m17", nextMatchSlot: "home" }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D2",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Germany",
        nextMatchId: "m17",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m17",
        apiFixtureId: 202617,
        round: "round_of_16",
        roundIndex: 2,
        matchNumber: 17,
        homeSlotKey: "W-M1",
        awaySlotKey: "W-M2",
        homeTeamId: "official-home",
        awayTeamId: "official-away",
        homeTeamName: "Official Home",
        awayTeamName: "Official Away",
        status: "final",
        homeScore: 1,
        awayScore: 0,
        winnerTeamId: "team-a",
        winnerTeamName: "Argentina",
        apiStatusShort: "FT",
      }),
    ]
    const savedPicks = [
      makePick({ id: "p-m1", matchId: "m1", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m2", matchId: "m2", selectedTeamId: "team-d", selectedSlotKey: "D2", selectedTeamName: "Germany" }),
    ]

    const projected = buildWorldCupProjectedMatches(matches, savedPicks)
    const official = projected.find((match) => match.id === "m17")

    expect(official).toMatchObject({
      status: "final",
      homeScore: 1,
      awayScore: 0,
      winnerTeamId: "team-a",
      winnerTeamName: "Argentina",
      apiStatusShort: "FT",
    })
    expect(isWorldCupMatchPickable(official!)).toBe(false)
  })

  it("projects pickable winners through quarterfinals, semifinals, final, and champion", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m17", nextMatchSlot: "home" }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D2",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Germany",
        nextMatchId: "m17",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m3",
        matchNumber: 3,
        homeSlotKey: "E1",
        awaySlotKey: "F2",
        homeTeamId: "team-e",
        awayTeamId: "team-f",
        homeTeamName: "Spain",
        awayTeamName: "Japan",
        nextMatchId: "m18",
        nextMatchSlot: "home",
      }),
      makeMatch({
        id: "m4",
        matchNumber: 4,
        homeSlotKey: "G1",
        awaySlotKey: "H2",
        homeTeamId: "team-g",
        awayTeamId: "team-h",
        homeTeamName: "Portugal",
        awayTeamName: "Uruguay",
        nextMatchId: "m18",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m17",
        round: "round_of_16",
        roundIndex: 2,
        matchNumber: 17,
        homeSlotKey: "W-M1",
        awaySlotKey: "W-M2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 1",
        awayTeamName: "Winner Match 2",
        nextMatchId: "m25",
        nextMatchSlot: "home",
        status: "final",
        apiStatusShort: "SIM",
        homeScore: 1,
        awayScore: 0,
        winnerTeamName: "Winner Match 1",
      }),
      makeMatch({
        id: "m18",
        round: "round_of_16",
        roundIndex: 2,
        matchNumber: 18,
        homeSlotKey: "W-M3",
        awaySlotKey: "W-M4",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 3",
        awayTeamName: "Winner Match 4",
        nextMatchId: "m25",
        nextMatchSlot: "away",
        status: "final",
        apiStatusShort: "TEST",
        homeScore: 0,
        awayScore: 3,
        winnerTeamName: "Winner Match 4",
      }),
      makeMatch({
        id: "m25",
        round: "quarterfinal",
        roundIndex: 3,
        matchNumber: 25,
        homeSlotKey: "W-M17",
        awaySlotKey: "W-M18",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 17",
        awayTeamName: "Winner Match 18",
        nextMatchId: "m29",
        nextMatchSlot: "home",
        status: "final",
        apiStatusShort: "SIM",
        startsAt: "2020-01-01T00:00:00.000Z",
        homeScore: 3,
        awayScore: 1,
        winnerTeamName: "Best 3rd Place Team 1",
      }),
      makeMatch({
        id: "m26",
        round: "quarterfinal",
        roundIndex: 3,
        matchNumber: 26,
        homeSlotKey: "I1",
        awaySlotKey: "J2",
        homeTeamId: "team-i",
        awayTeamId: "team-j",
        homeTeamName: "England",
        awayTeamName: "Mexico",
        nextMatchId: "m29",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m29",
        round: "semifinal",
        roundIndex: 4,
        matchNumber: 29,
        homeSlotKey: "W-M25",
        awaySlotKey: "W-M26",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 25",
        awayTeamName: "Winner Match 26",
        nextMatchId: "m31",
        nextMatchSlot: "home",
        status: "final",
        apiStatusShort: "SIM",
      }),
      makeMatch({
        id: "m30",
        round: "semifinal",
        roundIndex: 4,
        matchNumber: 30,
        homeSlotKey: "K1",
        awaySlotKey: "L2",
        homeTeamId: "team-k",
        awayTeamId: "team-l",
        homeTeamName: "Netherlands",
        awayTeamName: "Italy",
        nextMatchId: "m31",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m31",
        round: "final",
        roundIndex: 5,
        matchNumber: 31,
        homeSlotKey: "W-M29",
        awaySlotKey: "W-M30",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 29",
        awayTeamName: "Winner Match 30",
        status: "final",
        apiStatusShort: "SIM",
        startsAt: "2020-01-01T00:00:00.000Z",
        homeScore: 3,
        awayScore: 1,
        winnerTeamName: "Best 3rd Place Team 1",
      }),
    ]
    const roundOf32Picks = [
      makePick({ id: "p-m1", matchId: "m1", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m2", matchId: "m2", selectedTeamId: "team-d", selectedSlotKey: "D2", selectedTeamName: "Germany" }),
      makePick({ id: "p-m3", matchId: "m3", selectedTeamId: "team-e", selectedSlotKey: "E1", selectedTeamName: "Spain" }),
      makePick({ id: "p-m4", matchId: "m4", selectedTeamId: "team-g", selectedSlotKey: "G1", selectedTeamName: "Portugal" }),
    ]
    const afterRoundOf32 = buildWorldCupProjectedMatches(matches, roundOf32Picks)
    expect(afterRoundOf32.find((match) => match.id === "m17")).toMatchObject({
      homeTeamName: "Argentina",
      awayTeamName: "Germany",
      status: "scheduled",
      apiStatusShort: null,
    })
    expect(afterRoundOf32.find((match) => match.id === "m18")).toMatchObject({
      homeTeamName: "Spain",
      awayTeamName: "Portugal",
      status: "scheduled",
      apiStatusShort: null,
    })
    expect(findFirstUnpickedMatch(afterRoundOf32, roundOf32Picks, getOrderedRounds(afterRoundOf32))?.id).toBe("m17")

    const roundOf16Picks = [
      ...roundOf32Picks,
      makePick({ id: "p-m17", matchId: "m17", round: "round_of_16", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m18", matchId: "m18", round: "round_of_16", selectedTeamId: "team-e", selectedSlotKey: "E1", selectedTeamName: "Spain" }),
    ]
    const afterRoundOf16 = buildWorldCupProjectedMatches(matches, roundOf16Picks)
    expect(afterRoundOf16.find((match) => match.id === "m25")).toMatchObject({
      homeTeamName: "Argentina",
      awayTeamName: "Spain",
      status: "scheduled",
      apiStatusShort: null,
    })
    expect(isWorldCupMatchPickable(afterRoundOf16.find((match) => match.id === "m25")!)).toBe(true)

    const quarterfinalPicks = [
      ...roundOf16Picks,
      makePick({ id: "p-m25", matchId: "m25", round: "quarterfinal", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m26", matchId: "m26", round: "quarterfinal", selectedTeamId: "team-i", selectedSlotKey: "I1", selectedTeamName: "England" }),
    ]
    const afterQuarterfinals = buildWorldCupProjectedMatches(matches, quarterfinalPicks)
    expect(afterQuarterfinals.find((match) => match.id === "m29")).toMatchObject({
      homeTeamName: "Argentina",
      awayTeamName: "England",
      status: "scheduled",
      startsAt: null,
      homeScore: null,
      awayScore: null,
      winnerTeamName: null,
      apiStatusShort: null,
    })
    expect(isWorldCupMatchPickable(afterQuarterfinals.find((match) => match.id === "m29")!)).toBe(true)

    const semifinalPicks = [
      ...quarterfinalPicks,
      makePick({ id: "p-m29", matchId: "m29", round: "semifinal", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m30", matchId: "m30", round: "semifinal", selectedTeamId: "team-k", selectedSlotKey: "K1", selectedTeamName: "Netherlands" }),
    ]
    const afterSemifinals = buildWorldCupProjectedMatches(matches, semifinalPicks)
    expect(afterSemifinals.find((match) => match.id === "m31")).toMatchObject({
      homeTeamName: "Argentina",
      awayTeamName: "Netherlands",
      status: "scheduled",
      startsAt: null,
      homeScore: null,
      awayScore: null,
      winnerTeamName: null,
      apiStatusShort: null,
    })
    expect(isWorldCupMatchPickable(afterSemifinals.find((match) => match.id === "m31")!)).toBe(true)
    expect(isBracketComplete(afterSemifinals, semifinalPicks)).toBe(false)
    expect(countRemainingPicks(afterSemifinals, semifinalPicks)).toBe(1)

    const championPicks = [
      ...semifinalPicks,
      makePick({ id: "p-m31", matchId: "m31", round: "final", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
    ]
    const afterChampion = buildWorldCupProjectedMatches(matches, championPicks)
    expect(isBracketComplete(afterChampion, championPicks)).toBe(true)
  })

  it("supports 30 of 30 picks completed in test-mode style states", () => {
    const matches = Array.from({ length: 31 }, (_, idx) =>
      makeMatch({
        id: `m-${idx + 1}`,
        matchNumber: idx + 1,
        homeSlotKey: `H${idx + 1}`,
        awaySlotKey: `A${idx + 1}`,
        homeTeamId: `team-home-${idx + 1}`,
        awayTeamId: `team-away-${idx + 1}`,
        homeTeamName: `Home ${idx + 1}`,
        awayTeamName: `Away ${idx + 1}`,
        status: idx === 30 ? "final" : "scheduled",
        apiStatusShort: idx === 30 ? "FT" : "TEST",
      })
    )
    const picks = matches
      .slice(0, 30)
      .map((match, idx) =>
        makePick({
          id: `p-${idx + 1}`,
          matchId: match.id,
          matchNumber: match.matchNumber,
          selectedTeamId: match.homeTeamId,
          selectedSlotKey: match.homeSlotKey,
          selectedTeamName: match.homeTeamName,
        })
      )

    expect(picks.filter(hasWorldCupPickSelection)).toHaveLength(30)
    expect(countRemainingPicks(matches, picks)).toBe(0)
    expect(isBracketComplete(matches, picks)).toBe(true)
  })

  it("keeps projected match identity stable across recompute with round and matchNumber fallback", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m17", nextMatchSlot: "home" }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D2",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Germany",
        nextMatchId: "m17",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m17",
        round: "round_of_16",
        roundIndex: 2,
        matchNumber: 17,
        homeSlotKey: "W-M1",
        awaySlotKey: "W-M2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 1",
        awayTeamName: "Winner Match 2",
        nextMatchId: "m25",
        nextMatchSlot: "home",
        status: "final",
        apiStatusShort: "SIM",
      }),
      makeMatch({
        id: "m25",
        round: "quarterfinal",
        roundIndex: 3,
        matchNumber: 25,
        homeSlotKey: "W-M17",
        awaySlotKey: "W-M18",
        homeTeamId: null,
        awayTeamId: "team-x",
        homeTeamName: "Winner Match 17",
        awayTeamName: "England",
        status: "final",
        apiStatusShort: "SIM",
      }),
    ]
    const picks = [
      makePick({ id: "p-m1", matchId: "m1", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m2", matchId: "m2", selectedTeamId: "team-d", selectedSlotKey: "D2", selectedTeamName: "Germany" }),
      makePick({
        id: "p-m17-fallback",
        matchId: "temporary-client-id",
        matchNumber: 17,
        round: "round_of_16",
        selectedTeamId: "team-a",
        selectedSlotKey: "A1",
        selectedTeamName: "Argentina",
      }),
    ]

    const afterRoundOf16 = buildWorldCupProjectedMatches(matches, picks)
    const roundOf16 = afterRoundOf16.find((match) => match.id === "m17")!
    const quarterfinal = afterRoundOf16.find((match) => match.id === "m25")!

    expect(getWorldCupPickMatchMethod(picks[2], roundOf16)).toBe("round_matchNumber")
    expect(findWorldCupPickForMatch(picks, roundOf16)?.id).toBe("p-m17-fallback")
    expect(quarterfinal.homeTeamId).toBe("team-a")
    expect(quarterfinal.homeTeamName).toBe("Argentina")
    expect(isWorldCupMatchPickable(quarterfinal)).toBe(true)
  })

  it("prefers exact semifinal pick matchId over stale round+matchNumber fallback", () => {
    const matches = [
      makeMatch({
        id: "m29",
        round: "semifinal",
        roundIndex: 4,
        matchNumber: 29,
        homeSlotKey: "W-M25",
        awaySlotKey: "W-M26",
        homeTeamId: "team-a",
        awayTeamId: "team-b",
        homeTeamName: "Brazil",
        awayTeamName: "USA",
        nextMatchId: "m31",
        nextMatchSlot: "home",
      }),
      makeMatch({
        id: "m30",
        round: "semifinal",
        roundIndex: 4,
        matchNumber: 30,
        homeSlotKey: "W-M27",
        awaySlotKey: "W-M28",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "Croatia",
        awayTeamName: "Australia",
        nextMatchId: "m31",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m31",
        round: "final",
        roundIndex: 5,
        matchNumber: 31,
        homeSlotKey: "W-M29",
        awaySlotKey: "W-M30",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 29",
        awayTeamName: "Winner Match 30",
      }),
    ]

    const staleFallback = makePick({
      id: "stale-m29",
      matchId: "projected-semifinal-1",
      round: "semifinal",
      matchNumber: 29,
      selectedTeamId: "team-old",
      selectedSlotKey: "W-M25",
      selectedTeamName: "Winner Match 25",
    })
    const canonical = makePick({
      id: "m29-canonical",
      matchId: "m29",
      round: "semifinal",
      matchNumber: 29,
      selectedTeamId: "team-a",
      selectedSlotKey: "W-M25",
      selectedTeamName: "Brazil",
    })
    const semifinalTwo = makePick({
      id: "m30-canonical",
      matchId: "m30",
      round: "semifinal",
      matchNumber: 30,
      selectedTeamId: "team-c",
      selectedSlotKey: "W-M27",
      selectedTeamName: "Croatia",
    })

    const picks = [staleFallback, canonical, semifinalTwo]
    const projected = buildWorldCupProjectedMatches(matches, picks)

    expect(findWorldCupPickForMatch(picks, matches[0])?.id).toBe("m29-canonical")
    expect(projected.find((match) => match.id === "m31")).toMatchObject({
      homeTeamName: "Brazil",
      awayTeamName: "Croatia",
    })
  })

  it("clears dependent downstream picks without clearing the just-saved projected pick", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m17", nextMatchSlot: "home" }),
      makeMatch({
        id: "m17",
        round: "round_of_16",
        roundIndex: 2,
        matchNumber: 17,
        homeSlotKey: "W-M1",
        awaySlotKey: "W-M2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 1",
        awayTeamName: "Winner Match 2",
        nextMatchId: "m25",
        nextMatchSlot: "home",
      }),
      makeMatch({
        id: "m25",
        round: "quarterfinal",
        roundIndex: 3,
        matchNumber: 25,
        homeSlotKey: "W-M17",
        awaySlotKey: "W-M18",
        homeTeamId: null,
        awayTeamId: "team-x",
        homeTeamName: "Winner Match 17",
        awayTeamName: "England",
      }),
    ]
    const picks = [
      makePick({ id: "p-m1", matchId: "m1", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m17", matchId: "m17", matchNumber: 17, round: "round_of_16", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m25", matchId: "m25", matchNumber: 25, round: "quarterfinal", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
    ]

    expect(getInvalidDownstreamPickIds(matches, picks, "m1", "team-b")).toEqual([
      "p-m17",
      "p-m25",
    ])
    expect(getInvalidDownstreamPickIds(matches, picks, "m17", "team-b")).toEqual([
      "p-m25",
    ])
  })

  it("changing a semifinal clears only the dependent final pick", () => {
    const matches = [
      makeMatch({
        id: "m29",
        round: "semifinal",
        roundIndex: 4,
        matchNumber: 29,
        homeSlotKey: "W-M25",
        awaySlotKey: "W-M26",
        homeTeamId: "team-a",
        awayTeamId: "team-b",
        homeTeamName: "Brazil",
        awayTeamName: "USA",
        nextMatchId: "m31",
        nextMatchSlot: "home",
      }),
      makeMatch({
        id: "m30",
        round: "semifinal",
        roundIndex: 4,
        matchNumber: 30,
        homeSlotKey: "W-M27",
        awaySlotKey: "W-M28",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "Croatia",
        awayTeamName: "Australia",
        nextMatchId: "m31",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m31",
        round: "final",
        roundIndex: 5,
        matchNumber: 31,
        homeSlotKey: "W-M29",
        awaySlotKey: "W-M30",
        homeTeamId: "team-a",
        awayTeamId: "team-c",
        homeTeamName: "Brazil",
        awayTeamName: "Croatia",
      }),
    ]
    const picks = [
      makePick({ id: "p-m29", matchId: "m29", matchNumber: 29, round: "semifinal", selectedTeamId: "team-a", selectedSlotKey: "W-M25", selectedTeamName: "Brazil" }),
      makePick({ id: "p-m30", matchId: "m30", matchNumber: 30, round: "semifinal", selectedTeamId: "team-c", selectedSlotKey: "W-M27", selectedTeamName: "Croatia" }),
      makePick({ id: "p-m31", matchId: "m31", matchNumber: 31, round: "final", selectedTeamId: "team-a", selectedSlotKey: "W-M29", selectedTeamName: "Brazil" }),
    ]

    expect(getInvalidDownstreamPickIds(matches, picks, "m29", "team-b")).toEqual(["p-m31"])
    expect(getInvalidDownstreamPickIds(matches, picks, "m30", "team-d")).toEqual([])
  })

  it("overlays saved picks without dropping seeded base matches", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m17", nextMatchSlot: "home" }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D2",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Japan",
        nextMatchId: "m17",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m17",
        round: "round_of_16",
        roundIndex: 1,
        matchNumber: 17,
        homeSlotKey: "W-M1",
        awaySlotKey: "W-M2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 1",
        awayTeamName: "Winner Match 2",
      }),
    ]
    const savedPicks = [
      makePick({
        id: "p-m1",
        matchId: "m1",
        selectedTeamId: "team-a",
        selectedSlotKey: "A1",
        selectedTeamName: "Argentina",
      }),
    ]

    const projected = buildWorldCupProjectedMatches(matches, savedPicks)

    expect(projected.map((match) => match.id)).toEqual(["m1", "m2", "m17"])
    expect(projected.find((match) => match.id === "m1")?.homeTeamName).toBe("Argentina")
    expect(projected.find((match) => match.id === "m2")?.homeTeamName).toBe("France")
    expect(projected.find((match) => match.id === "m17")?.homeTeamName).toBe("Argentina")
    expect(findFirstUnpickedMatch(projected, savedPicks, getOrderedRounds(projected))?.id).toBe("m2")
  })

  it("keeps an incomplete saved bracket incomplete after refresh", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m3", nextMatchSlot: "home" }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D2",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Japan",
        nextMatchId: "m3",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m3",
        round: "round_of_16",
        roundIndex: 2,
        matchNumber: 3,
        homeSlotKey: "W-M1",
        awaySlotKey: "W-M2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "TBD",
        awayTeamName: "TBD",
      }),
    ]
    const savedPicks = [makePick({ id: "p-m1", matchId: "m1" })]
    const projected = buildWorldCupProjectedMatches(matches, savedPicks)

    expect(isBracketComplete(projected, savedPicks)).toBe(false)
    expect(countRemainingPicks(projected.filter(isWorldCupMatchPickable), savedPicks)).toBe(1)
  })

  it("keeps a completed saved bracket complete only when all required real selections exist", () => {
    const matches = [
      makeMatch({ id: "m1", matchNumber: 1, nextMatchId: "m3", nextMatchSlot: "home" }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeSlotKey: "C1",
        awaySlotKey: "D2",
        homeTeamId: "team-c",
        awayTeamId: "team-d",
        homeTeamName: "France",
        awayTeamName: "Japan",
        nextMatchId: "m3",
        nextMatchSlot: "away",
      }),
      makeMatch({
        id: "m3",
        round: "round_of_16",
        roundIndex: 2,
        matchNumber: 3,
        homeSlotKey: "W-M1",
        awaySlotKey: "W-M2",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "TBD",
        awayTeamName: "TBD",
      }),
    ]
    const savedPicks = [
      makePick({ id: "p-m1", matchId: "m1", selectedTeamId: "team-a", selectedSlotKey: "A1", selectedTeamName: "Argentina" }),
      makePick({ id: "p-m2", matchId: "m2", selectedTeamId: "team-d", selectedSlotKey: "D2", selectedTeamName: "Japan" }),
      makePick({
        id: "p-m3",
        matchId: "m3",
        round: "round_of_16",
        selectedTeamId: "team-a",
        selectedSlotKey: "A1",
        selectedTeamName: "Argentina",
      }),
    ]
    const projected = buildWorldCupProjectedMatches(matches, savedPicks)

    expect(isBracketComplete(projected, savedPicks)).toBe(true)
    expect(
      isBracketComplete(projected, [
        ...savedPicks.slice(0, 2),
        makePick({
          id: "placeholder",
          matchId: "m3",
          round: "round_of_16",
          selectedTeamId: null,
          selectedSlotKey: null,
          selectedTeamName: "TBD",
        }),
      ])
    ).toBe(false)
  })

  it("keeps saved picks scoped to the active entry when switching entries", () => {
    const matches = [makeMatch()]
    const entryPicks: Record<string, WorldCupPickView[]> = {
      "entry-1": [makePick({ id: "entry-1-pick", selectedTeamId: "team-a", selectedSlotKey: "A1" })],
      "entry-2": [makePick({ id: "entry-2-pick", selectedTeamId: "team-b", selectedSlotKey: "B2", selectedTeamName: "Brazil" })],
    }

    expect(entryPicks["entry-1"]).toHaveLength(1)
    expect(entryPicks["entry-2"]).toHaveLength(1)
    expect(entryPicks["entry-1"][0].selectedTeamId).toBe("team-a")
    expect(entryPicks["entry-2"][0].selectedTeamId).toBe("team-b")
    expect(isBracketComplete(matches, entryPicks["entry-1"])).toBe(true)
    expect(isBracketComplete(matches, entryPicks["entry-2"])).toBe(true)
  })

  it("treats a generated Round of 32 bracket as complete after all generated matchups are picked", () => {
    const templateMatches = [
      makeMatch({
        id: "m1",
        matchNumber: 1,
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Group A Winner",
        awayTeamName: "Group B Runner-up",
        homeSlotKey: "A1",
        awaySlotKey: "B2",
      }),
      makeMatch({
        id: "m2",
        matchNumber: 2,
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Group C Winner",
        awayTeamName: "Best 3rd Place Team 1",
        homeSlotKey: "C1",
        awaySlotKey: "D3",
      }),
    ]
    const generated = buildWorldCupMatchesFromGroupPredictions({
      matches: templateMatches,
      groupStageView: makeCompleteGroupStageProjection({
        groupAWinner: { id: "team-a1", name: "Mexico" },
        groupBRunnerUp: { id: "team-b2", name: "Canada" },
        thirdPlaceTeam: { id: "team-b3", name: "Morocco", groupKey: "B" },
      }),
    }).matches
    const picks = [
      makePick({ id: "p-m1", matchId: "m1", matchNumber: 1, selectedTeamId: "team-a1", selectedSlotKey: "A1", selectedTeamName: "Mexico" }),
      makePick({ id: "p-m2", matchId: "m2", matchNumber: 2, selectedTeamId: "team-b3", selectedSlotKey: "D3", selectedTeamName: "Morocco" }),
    ]

    expect(generated.every((match) => isWorldCupMatchPickable(match))).toBe(true)
    expect(isBracketComplete(generated, picks)).toBe(true)
    expect(countRemainingPicks(generated, picks)).toBe(0)
  })

  it("keeps each of 5 saved bracket pick lists independent", () => {
    const entryPicks = Object.fromEntries(
      Array.from({ length: 5 }, (_, idx) => [
        `entry-${idx + 1}`,
        [
          makePick({
            id: `entry-${idx + 1}-pick`,
            matchId: `m${idx + 1}`,
            selectedTeamId: `team-${idx + 1}`,
            selectedSlotKey: `S${idx + 1}`,
            selectedTeamName: `Team ${idx + 1}`,
          }),
        ],
      ])
    ) as Record<string, WorldCupPickView[]>

    expect(Object.keys(entryPicks)).toHaveLength(5)
    for (let idx = 1; idx <= 5; idx += 1) {
      expect(entryPicks[`entry-${idx}`]).toHaveLength(1)
      expect(entryPicks[`entry-${idx}`][0].matchId).toBe(`m${idx}`)
      expect(entryPicks[`entry-${idx}`][0].selectedTeamId).toBe(`team-${idx}`)
    }
  })

  it("fixtures_not_ready state has no pickable matches until team IDs are set", () => {
    // Simulates the state shown to the user before Load Test Fixtures runs
    const bracketMatches = Array.from({ length: 31 }, (_, idx) =>
      makeMatch({
        id: `m-${idx + 1}`,
        matchNumber: idx + 1,
        round: idx < 16 ? "round_of_32" : idx < 24 ? "round_of_16" : idx < 28 ? "quarterfinal" : idx < 30 ? "semifinal" : "final",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: `TBD-H${idx + 1}`,
        awayTeamName: `TBD-A${idx + 1}`,
      })
    )
    expect(getWorldCupGuidedPicksState(bracketMatches)).toBe("fixtures_not_ready")
    expect(bracketMatches.filter((m) => isWorldCupMatchPickable(m)).length).toBe(0)

    // After Load Test Fixtures patches Round of 32 matches with real team IDs
    const after = bracketMatches.map((m, idx) =>
      idx < 16
        ? { ...m, homeTeamId: `demo-home-${idx + 1}`, awayTeamId: `demo-away-${idx + 1}`, homeTeamName: `Team ${idx * 2 + 1}`, awayTeamName: `Team ${idx * 2 + 2}`, apiStatusShort: "TEST" }
        : m
    )
    expect(getWorldCupGuidedPicksState(after)).toBe("ready")
    expect(after.filter((m) => isWorldCupMatchPickable(m)).length).toBe(16)
  })
})

describe("World Cup projected knockout readiness (semifinal / final)", () => {
  it("getWorldCupProjectedMatchTeams treats Brazil vs USA semifinal as ready when ids and names are real", () => {
    const sf = makeMatch({
      id: "m29",
      round: "semifinal",
      roundIndex: 4,
      matchNumber: 29,
      homeSlotKey: "W-M27",
      awaySlotKey: "W-M28",
      homeTeamId: "team-bra",
      awayTeamId: "team-usa",
      homeTeamName: "Brazil",
      awayTeamName: "USA",
    })
    const eff = getWorldCupProjectedMatchTeams(sf)
    expect(eff.readyForPicks).toBe(true)
    expect(eff.home.teamName).toBe("Brazil")
    expect(eff.away.teamName).toBe("USA")
    expect(isWorldCupMatchPickable(sf)).toBe(true)
  })

  it("rejects placeholder-style labels even when team ids are present", () => {
    const sf = makeMatch({
      round: "semifinal",
      matchNumber: 29,
      homeTeamId: "x",
      awayTeamId: "y",
      homeTeamName: "Group D Winner",
      awayTeamName: "Best 3rd Place Team 1",
    })
    expect(getWorldCupProjectedMatchTeams(sf).readyForPicks).toBe(false)
    expect(isWorldCupMatchPickable(sf)).toBe(false)
    expect(getWorldCupUnpickableReason(sf)).toBe("placeholder_team")
  })

  it("unresolved feeder slots stay not ready", () => {
    const sf = makeMatch({
      round: "semifinal",
      matchNumber: 29,
      homeTeamId: null,
      awayTeamId: null,
      homeTeamName: "Winner Match 27",
      awayTeamName: "Winner Match 28",
    })
    expect(getWorldCupProjectedMatchTeams(sf).readyForPicks).toBe(false)
    expect(getWorldCupUnpickableReason(sf)).toBe("missing_home_team")
  })

  it("projected final uses both semifinal winners and is pickable", () => {
    const finalMatch = makeMatch({
      id: "m31",
      round: "final",
      roundIndex: 5,
      matchNumber: 31,
      homeSlotKey: "W-M29",
      awaySlotKey: "W-M30",
      homeTeamId: "team-a",
      awayTeamId: "team-k",
      homeTeamName: "Argentina",
      awayTeamName: "Netherlands",
    })
    const eff = getWorldCupProjectedMatchTeams(finalMatch)
    expect(eff.readyForPicks).toBe(true)
    expect(isWorldCupMatchPickable(finalMatch)).toBe(true)
  })
})

describe("TBD qualifier virtual teams (Issue 1 fix)", () => {
  it("TBD slot produces a virtual team with a non-placeholder name so R32 match is pickable", () => {
    const projection = makeCompleteGroupStageProjection()
    const r32TbdMatch = makeMatch({
      id: "r32-tbd",
      round: "round_of_32",
      matchNumber: 16,
      homeSlotKey: "TBD1",
      awaySlotKey: "TBD2",
      homeTeamId: null,
      awayTeamId: null,
      homeTeamName: "TBD Qualifier 1",
      awayTeamName: "TBD Qualifier 2",
    })
    const result = buildWorldCupMatchesFromGroupPredictions({
      matches: [r32TbdMatch],
      groupStageView: { ...projection, bestThirdMappingConfirmed: true } as never,
      bestThirdMappingConfirmed: true,
    })
    const tbd = result.matches.find((m) => m.id === "r32-tbd")!
    expect(tbd.homeTeamId).toBe("tbd-qualifier-1")
    expect(tbd.awayTeamId).toBe("tbd-qualifier-2")
    expect(tbd.homeTeamName).toBe("TBD Qualifier 1")
    expect(tbd.awayTeamName).toBe("TBD Qualifier 2")
    expect(isWorldCupMatchPickable(tbd)).toBe(true)
  })

  it("TBD virtual team cascades so downstream R16 match is also pickable after a pick", () => {
    // Simulate real app call order: group-stage projection assigns virtual IDs first,
    // then buildWorldCupProjectedMatches cascades picks downstream.
    const r32TbdMatch = makeMatch({
      id: "r32-tbd",
      round: "round_of_32",
      matchNumber: 16,
      homeSlotKey: "TBD1",
      awaySlotKey: "TBD2",
      // Virtual teams already applied by buildWorldCupMatchesFromGroupPredictions
      homeTeamId: "tbd-qualifier-1",
      awayTeamId: "tbd-qualifier-2",
      homeTeamName: "TBD Qualifier 1",
      awayTeamName: "TBD Qualifier 2",
      nextMatchId: "r16-next",
      nextMatchSlot: "home",
    })
    const r16Match = makeMatch({
      id: "r16-next",
      round: "round_of_16",
      matchNumber: 24,
      homeSlotKey: "W-M16",
      awaySlotKey: "K2",
      homeTeamId: null,
      awayTeamId: "team-k2",
      homeTeamName: "Winner Match 16",
      awayTeamName: "Netherlands",
      nextMatchId: null,
    })
    const pick = makePick({ matchId: "r32-tbd", selectedTeamId: "tbd-qualifier-1", selectedSlotKey: "TBD1" })
    const projected = buildWorldCupProjectedMatches([r32TbdMatch, r16Match], [pick])
    const projected16 = projected.find((m) => m.id === "r16-next")!
    expect(projected16.homeTeamId).toBe("tbd-qualifier-1")
    expect(isWorldCupMatchPickable(projected16)).toBe(true)
  })
})
