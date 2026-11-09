import { describe, expect, it } from "vitest"
import { collegeRivalry } from "@/lib/college/rivalryCrests"

describe("collegeRivalry", () => {
  it("names each rivalry from ESPN's college display names, either way round", () => {
    expect(collegeRivalry("NCAAF", "Auburn Tigers", "Alabama Crimson Tide")).toBe("iron")
    expect(collegeRivalry("NCAAF", "Michigan Wolverines", "Ohio State Buckeyes")).toBe("game")
    expect(collegeRivalry("NCAAF", "Texas Longhorns", "Oklahoma Sooners")).toBe("river")
    expect(collegeRivalry("NCAAF", "Mississippi State Bulldogs", "Ole Miss Rebels")).toBe("egg")
    expect(collegeRivalry("NCAAF", "Navy Midshipmen", "Army Black Knights")).toBe("service")
    expect(collegeRivalry("NCAAF", "Washington State Cougars", "Washington Huskies")).toBe("apple")
    expect(collegeRivalry("NCAAF", "Utah Utes", "BYU Cougars")).toBe("holy")
    expect(collegeRivalry("NCAAF", "West Virginia Mountaineers", "Pittsburgh Panthers")).toBe("brawl")
  })

  it("accepts a bare school name", () => {
    expect(collegeRivalry("ncaaf", "Alabama", "Auburn")).toBe("iron")
  })

  it("never mistakes a same-state school for the rival", () => {
    expect(collegeRivalry("NCAAF", "Ohio State Buckeyes", "Michigan State Spartans")).toBeNull()
    expect(collegeRivalry("NCAAF", "Washington Huskies", "Washington State")).toBe("apple")
    expect(collegeRivalry("NCAAF", "BYU Cougars", "Utah State Aggies")).toBeNull()
    expect(collegeRivalry("NCAAF", "Texas A&M Aggies", "Oklahoma Sooners")).toBeNull()
    expect(collegeRivalry("NCAAF", "Oklahoma State Cowboys", "Texas Longhorns")).toBeNull()
  })

  it("is college football only, and needs both teams", () => {
    expect(collegeRivalry("NCAAB", "Alabama Crimson Tide", "Auburn Tigers")).toBeNull()
    expect(collegeRivalry("NFL", "Pittsburgh Steelers", "West Virginia Mountaineers")).toBeNull()
    expect(collegeRivalry("NCAAF", "Alabama Crimson Tide", "Georgia Bulldogs")).toBeNull()
    expect(collegeRivalry("NCAAF", "Alabama Crimson Tide", null)).toBeNull()
  })
})
