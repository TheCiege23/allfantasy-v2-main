import { describe, expect, it } from "vitest"
import {
  indexSeriesByNumber,
  isValidPlayoffPickTeamName,
  pickTeamNameBySeriesId,
  projectBracketSeriesSides,
} from "@/lib/playoffs/playoffBracketProjection"
import type { PlayoffPickView, PlayoffSeriesView } from "@/lib/playoffs/types"

const baseSeriesProps = {
  winnerTeamName: null,
  bestOf: 7,
  status: "scheduled" as const,
  startsAt: null,
  nextSeriesNumber: null,
  nextSeriesSlot: null,
}

function mkSeries(part: Omit<PlayoffSeriesView, "id"> & { id: string }): PlayoffSeriesView {
  return part
}

describe("playoff bracket projection", () => {
  it("shows upstream winners on dependent series when picks exist", () => {
    const s1 = mkSeries({
      ...baseSeriesProps,
      id: "sid-1",
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 1,
      conference: "east",
      homeSeed: 1,
      awaySeed: 8,
      homeTeamName: "Rangers",
      awayTeamName: "Red Wings",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    })
    const s2 = mkSeries({
      ...baseSeriesProps,
      id: "sid-2",
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 2,
      conference: "east",
      homeSeed: 4,
      awaySeed: 5,
      homeTeamName: "Maple Leafs",
      awayTeamName: "Bruins",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    })
    const s9 = mkSeries({
      ...baseSeriesProps,
      id: "sid-9",
      round: "conference_semifinals",
      roundIndex: 2,
      seriesNumber: 9,
      conference: "east",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "Winner S1",
      awayTeamName: "Winner S2",
      sourceSeriesHome: 1,
      sourceSeriesAway: 2,
    })
    const byNum = indexSeriesByNumber([s1, s2, s9])
    const picks: PlayoffPickView[] = [
      {
        id: "p1",
        entryId: "e",
        seriesId: s1.id,
        pickTeamName: "Rangers",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "p2",
        entryId: "e",
        seriesId: s2.id,
        pickTeamName: "Bruins",
        createdAt: "",
        updatedAt: "",
      },
    ]
    const pickIdx = pickTeamNameBySeriesId(picks)

    expect(projectBracketSeriesSides(s9, byNum, pickIdx)).toEqual({
      displayHomeTeamName: "Rangers",
      displayAwayTeamName: "Bruins",
      homeSelectable: true,
      awaySelectable: true,
    })
  })

  it("falls back to placeholder labels when feeders are unresolved", () => {
    const s1 = mkSeries({
      ...baseSeriesProps,
      id: "sid-1",
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 1,
      conference: "east",
      homeSeed: 1,
      awaySeed: 8,
      homeTeamName: "Rangers",
      awayTeamName: "Red Wings",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    })
    const s9 = mkSeries({
      ...baseSeriesProps,
      id: "sid-9",
      round: "conference_semifinals",
      roundIndex: 2,
      seriesNumber: 9,
      conference: "east",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "Winner S1",
      awayTeamName: "Winner S2",
      sourceSeriesHome: 1,
      sourceSeriesAway: 2,
    })
    const byNum = indexSeriesByNumber([s1, s9])
    const pickIdx = pickTeamNameBySeriesId([])

    expect(projectBracketSeriesSides(s9, byNum, pickIdx)).toMatchObject({
      displayHomeTeamName: "Winner S1",
      displayAwayTeamName: "Winner S2",
      homeSelectable: false,
      awaySelectable: false,
    })

    expect(isValidPlayoffPickTeamName(s9, "Rangers", byNum, pickIdx)).toBe(false)
    expect(isValidPlayoffPickTeamName(s1, "Rangers", byNum, pickIdx)).toBe(true)
  })

  it("locks dependent matchup until BOTH feeder picks exist", () => {
    const s1 = mkSeries({
      ...baseSeriesProps,
      id: "sid-1",
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 1,
      conference: "east",
      homeSeed: 1,
      awaySeed: 8,
      homeTeamName: "Rangers",
      awayTeamName: "Red Wings",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    })
    const s2 = mkSeries({
      ...baseSeriesProps,
      id: "sid-2",
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 2,
      conference: "east",
      homeSeed: 4,
      awaySeed: 5,
      homeTeamName: "Maple Leafs",
      awayTeamName: "Bruins",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    })
    const s9 = mkSeries({
      ...baseSeriesProps,
      id: "sid-9",
      round: "conference_semifinals",
      roundIndex: 2,
      seriesNumber: 9,
      conference: "east",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "Winner S1",
      awayTeamName: "Winner S2",
      sourceSeriesHome: 1,
      sourceSeriesAway: 2,
    })
    const byNum = indexSeriesByNumber([s1, s2, s9])
    const partialIdx = pickTeamNameBySeriesId([
      {
        id: "p1",
        entryId: "e",
        seriesId: s1.id,
        pickTeamName: "Rangers",
        createdAt: "",
        updatedAt: "",
      },
    ])

    expect(projectBracketSeriesSides(s9, byNum, partialIdx)).toMatchObject({
      displayHomeTeamName: "Rangers",
      displayAwayTeamName: "Winner S2",
      homeSelectable: false,
      awaySelectable: false,
    })
    expect(isValidPlayoffPickTeamName(s9, "Rangers", byNum, partialIdx)).toBe(false)
  })
})
