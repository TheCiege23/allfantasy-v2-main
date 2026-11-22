import { describe, expect, it } from "vitest"
import { hubSeasonYear, orderHubTournaments } from "@/lib/brackets/hubTournaments"

const order = (iso: string) => orderHubTournaments(new Date(iso)).map((t) => `${t.tournament}${t.live ? "*" : ""}:${t.season}`)

describe("which bracket tournament the hub leads with", () => {
  it("leads with the NBA Cup in November, then the CFP, then the NFL playoffs", () => {
    expect(order("2026-11-01T12:00:00Z")).toEqual(["nba_cup*:2026", "ncaaf:2026", "nfl:2026"])
  })

  it("keeps the Cup first through its final, with the CFP live alongside from December", () => {
    expect(order("2026-12-10T12:00:00Z")).toEqual(["nba_cup*:2026", "ncaaf*:2026", "nfl:2026"])
  })

  it("runs the CFP ahead of the NFL playoffs while both are live, and stores both under last year's season", () => {
    expect(order("2027-01-10T12:00:00Z")).toEqual(["ncaaf*:2026", "nfl*:2026", "nba_cup:2027"])
  })

  it("leaves only the NFL live after the CFP title game, and the Cup next after the Super Bowl", () => {
    expect(order("2027-02-01T12:00:00Z")).toEqual(["nfl*:2026", "nba_cup:2027", "ncaaf:2027"])
    expect(order("2027-03-01T12:00:00Z")).toEqual(["nba_cup:2027", "ncaaf:2027", "nfl:2027"])
  })

  it("treats each window's last day as inside it", () => {
    expect(order("2026-12-20T23:00:00Z")[0]).toBe("nba_cup*:2026")
    expect(order("2026-12-21T01:00:00Z")[0]).toBe("ncaaf*:2026")
  })

  it("files January playoff games under the season that started the year before", () => {
    expect(hubSeasonYear("ncaaf", new Date("2027-01-15T00:00:00Z"))).toBe(2026)
    expect(hubSeasonYear("nfl", new Date("2027-02-08T00:00:00Z"))).toBe(2026)
    expect(hubSeasonYear("nba_cup", new Date("2026-11-01T00:00:00Z"))).toBe(2026)
  })
})
