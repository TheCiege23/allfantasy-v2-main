import { describe, expect, it } from "vitest"
import group from "../../contracts/espn/fixtures/scoreboard.NBA.20261106.json"
import final from "../../contracts/espn/fixtures/scoreboard.NBA.20251216.json"
import { nbaCupLiveWindowOpen, parseNbaCupScoreboard } from "@/lib/playoffs/nbaCupTournament"
import {
  buildNbaCupGroups,
  cupGameDetail,
  cupGameProgress,
  cupLiveClock,
  projectedQuarterfinalSeeds,
  wildCardRace,
} from "@/lib/playoffs/nbaCupBoard"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"

describe("NBA Cup live and box-score detail from the captured scoreboard", () => {
  it("reads the final's top scorer, quarter lines and team colours", () => {
    const [game] = parseNbaCupScoreboard(final, 2025)
    expect(game.statusDetail).toBe("Final")
    expect(game.homeTeamName).toBe("New York Knicks")
    expect(game.homeLeader).toEqual({ name: "OG Anunoby", points: 28 })
    expect(game.awayLeader?.name).toBeTruthy()
    expect(game.homeLines).toEqual([28, 31, 30, 35])
    expect(game.homeLines!.reduce((a, b) => a + b, 0)).toBe(game.homeScore)
    expect(game.homeColor).toBe("#1d428a")
    expect(game.homeAbbr).toBe("NY")
  })

  it("never reads pregame leaders, which are season averages, as a game's top scorer", () => {
    const games = parseNbaCupScoreboard(group, 2026)
    // The capture carries a 20.5-point "leader" on a game not yet played.
    expect(group.events[0].competitions[0].competitors[0].leaders?.[0]?.leaders?.[0]?.displayValue).toBe("20.5")
    expect(games.every((g) => g.homeLeader === null && g.awayLeader === null)).toBe(true)
    expect(games.every((g) => g.homeLines!.length === 0 && g.statusDetail === null && g.clock === null)).toBe(true)
  })

  it("opens the live window ten minutes before tipoff and holds it four hours after", () => {
    const [game] = parseNbaCupScoreboard(group, 2026)
    const tip = Date.parse(game.startsAt!)
    expect(nbaCupLiveWindowOpen([game], tip - 11 * 60_000)).toBe(false)
    expect(nbaCupLiveWindowOpen([game], tip - 9 * 60_000)).toBe(true)
    expect(nbaCupLiveWindowOpen([game], tip + 3.9 * 3600_000)).toBe(true)
    expect(nbaCupLiveWindowOpen([game], tip + 4.1 * 3600_000)).toBe(false)
    expect(nbaCupLiveWindowOpen([{ ...game, status: "in_progress" }], tip + 9 * 3600_000)).toBe(true)
    expect(nbaCupLiveWindowOpen([{ ...game, status: "final" }], tip)).toBe(false)
    expect(nbaCupLiveWindowOpen([{ ...game, blocked: true }], tip)).toBe(false)
  })
})

let seq = 0
function row(home: string, away: string, opts: Partial<PlayoffSeriesView> & { hs?: number; as?: number } = {}): PlayoffSeriesView {
  seq++
  const { hs, as, ...rest } = opts
  const final = hs != null && as != null
  return {
    id: `g${seq}`, round: "cup_group_play", roundIndex: 0, seriesNumber: 100 + seq, conference: "east",
    homeSeed: 0, awaySeed: 0, homeTeamName: home, awayTeamName: away,
    winnerTeamName: final ? (hs! > as! ? home : away) : null, bestOf: 1,
    status: final ? "final" : "scheduled", startsAt: new Date(Date.UTC(2026, 10, 6 + seq)).toISOString(),
    liveHomeScore: final ? hs! : null, liveAwayScore: final ? as! : null,
    nextSeriesNumber: null, nextSeriesSlot: null, sourceSeriesHome: null, sourceSeriesAway: null,
    ...rest,
  } as PlayoffSeriesView
}

const A = ["Atlanta Hawks", "Boston Celtics", "Charlotte Hornets", "Chicago Bulls", "Washington Wizards"]
const B = ["Brooklyn Nets", "Miami Heat", "New York Knicks", "Orlando Magic", "Toronto Raptors"]

describe("NBA Cup group standings", () => {
  it("recovers each group from who plays whom and ranks by record", () => {
    const games = [
      row(A[0], A[4], { hs: 112, as: 104 }), row(A[1], A[2], { hs: 109, as: 103 }),
      row(A[3], A[0], { hs: 114, as: 120 }), row(B[0], B[1], { hs: 99, as: 101 }),
      row(A[2], A[4], {}), row(B[1], B[2], {}),
    ]
    const groups = buildNbaCupGroups(games)
    expect(groups.map((g) => g.label)).toEqual(["East Group 1", "East Group 2"])
    expect(groups[0].teams.map((t) => t.team).sort()).toEqual([...A].sort())
    // Only part of Group B has synced: the component is the three teams joined so far, not a guess.
    expect(groups[1].teams.map((t) => t.team).sort()).toEqual([B[0], B[1], B[2]].sort())
    const atl = groups[0].teams[0]
    expect(atl).toMatchObject({ team: A[0], wins: 2, losses: 0, pointDiff: 14 })
    expect(atl.results.slice(0, 2)).toEqual(["W", "W"])
  })

  it("claims a clinch only when no remaining result can catch the leader", () => {
    // A[0] finished 4-0; every rival has a loss and at most three games left.
    const games = [
      row(A[0], A[1], { hs: 110, as: 100 }), row(A[0], A[2], { hs: 110, as: 100 }), row(A[0], A[3], { hs: 110, as: 100 }),
      row(A[4], A[0], { hs: 90, as: 100 }),
      row(A[1], A[2], {}), row(A[1], A[3], {}), row(A[1], A[4], {}), row(A[2], A[3], {}), row(A[2], A[4], {}), row(A[3], A[4], {}),
    ]
    const g = buildNbaCupGroups(games)[0]
    const by = (name: string) => g.teams.find((t) => t.team === name)!
    expect(by(A[0]).status).toBe("clinched_group")
    expect(by(A[2]).status).toBe("wild_card_only")
    expect(by(A[2]).path).toMatch(/wild card/i)
  })

  it("does not claim a clinch while a rival can still tie the leader", () => {
    const games = [
      row(A[0], A[1], { hs: 110, as: 100 }), row(A[0], A[2], { hs: 110, as: 100 }), row(A[0], A[3], { hs: 110, as: 100 }),
      row(A[1], A[2], { hs: 100, as: 90 }),
      row(A[4], A[0], {}), row(A[1], A[3], {}), row(A[1], A[4], {}), row(A[2], A[3], {}), row(A[2], A[4], {}), row(A[3], A[4], {}),
    ]
    const g = buildNbaCupGroups(games)[0]
    expect(g.teams.find((t) => t.team === A[0])!.status).toBe("controls_path")
  })

  it("says a team controls its path only when winning out beats every rival's ceiling", () => {
    const games = [
      row(A[0], A[1], { hs: 110, as: 100 }), row(A[2], A[3], { hs: 110, as: 100 }),
      row(A[0], A[2], {}), row(A[0], A[3], {}), row(A[0], A[4], {}), row(A[1], A[2], {}),
      row(A[1], A[3], {}), row(A[1], A[4], {}), row(A[2], A[4], {}), row(A[3], A[4], {}),
    ]
    const g = buildNbaCupGroups(games)[0]
    const by = (name: string) => g.teams.find((t) => t.team === name)!
    expect(by(A[0]).status).toBe("controls_path")
    expect(by(A[2]).status).toBe("controls_path")
    expect(by(A[1]).status).toBe("needs_help")
  })

  it("breaks an exact two-way tie head-to-head before point differential", () => {
    // A[1] beat A[0] narrowly; A[0] has the far better differential overall.
    const games = [
      row(A[1], A[0], { hs: 101, as: 100 }), row(A[0], A[2], { hs: 140, as: 90 }),
      row(A[3], A[1], { hs: 120, as: 100 }), row(A[3], A[4], { hs: 110, as: 100 }),
    ]
    const g = buildNbaCupGroups(games)[0]
    expect(g.teams.map((t) => t.team).slice(0, 3)).toEqual([A[3], A[1], A[0]])
  })

  it("settles the wild card and eliminations once every group in the conference is final", () => {
    const all: PlayoffSeriesView[] = []
    for (const teams of [A, B]) {
      for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
        all.push(row(teams[i], teams[j], { hs: 100 + (teams === B && i === 1 ? 20 : 5), as: 100 }))
      }
    }
    const groups = buildNbaCupGroups(all)
    expect(groups.every((g) => g.complete)).toBe(true)
    expect(groups.map((g) => g.teams[0].status)).toEqual(["won_group", "won_group"])
    const wild = wildCardRace(groups, "east")[0]
    const statuses = groups.flatMap((g) => g.teams.slice(1).map((t) => t.status))
    expect(statuses.filter((s) => s === "wild_card")).toHaveLength(1)
    expect(statuses.filter((s) => s === "eliminated")).toHaveLength(7)
    expect(groups.flatMap((g) => g.teams).find((t) => t.status === "wild_card")?.team).toBe(wild.team)
    const seeds = projectedQuarterfinalSeeds(groups, "east")
    expect(seeds.map((s) => s.seed)).toEqual([1, 2, 3])
    expect(seeds.every((s) => s.confirmed)).toBe(true)
    expect(seeds[2]).toMatchObject({ team: wild.team, how: "Wild card" })
  })

  it("projects nothing before a single conference game is final", () => {
    const groups = buildNbaCupGroups([row(A[0], A[1]), row(A[2], A[3])])
    expect(projectedQuarterfinalSeeds(groups, "east")).toEqual([])
  })
})

describe("NBA Cup live clock", () => {
  const live = (detail: unknown, extra: Record<string, unknown> = {}) =>
    row(A[0], A[1], { status: "in_progress", providerGamesJson: { live: { detail, ...extra } } })

  it("turns ESPN's short detail into a compact quarter and clock", () => {
    expect(cupLiveClock(live("4:12 - 3rd"))).toBe("Q3 4:12")
    expect(cupLiveClock(live("0.4 - 4th"))).toBe("Q4 0.4")
    expect(cupLiveClock(live("1:02 - OT"))).toBe("OT 1:02")
    expect(cupLiveClock(live("Halftime"))).toBe("Halftime")
    expect(cupLiveClock(live(null, { period: 2, clock: "5:10" }))).toBe("Q2 5:10")
    expect(cupLiveClock(row(A[0], A[1], { status: "in_progress", liveStatus: "in_progress" }))).toBe("Live")
  })

  it("reads missing detail as unknown rather than zero", () => {
    const d = cupGameDetail(row(A[0], A[1]))
    expect(d).toMatchObject({ detail: null, homeLeader: null, homeLines: [], homeColor: null })
    expect(cupGameProgress(live("4:12 - 3rd", { period: 3, clock: "4:12" }))).toBe(Math.round((1440 + 720 - 252) / 2880 * 100))
  })
})
