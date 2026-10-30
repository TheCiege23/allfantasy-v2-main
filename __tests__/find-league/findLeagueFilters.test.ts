import { describe, expect, it } from "vitest"
import {
  draftFitsWindow,
  matchesSearchText,
  parseLeagueSearch,
  rankBandFor,
  timeZoneRegionFor,
} from "@/lib/public-discovery/findLeagueFilters"

describe("rankBandFor", () => {
  it("higher league rank is a step up, equal is your level, lower is chill", () => {
    expect(rankBandFor(4, 3)).toBe("step_up")
    expect(rankBandFor(3, 3)).toBe("your_level")
    expect(rankBandFor(2, 3)).toBe("chill")
  })

  it("is null when either side is unknown, never a guess", () => {
    expect(rankBandFor(null, 3)).toBeNull()
    expect(rankBandFor(3, null)).toBeNull()
    expect(rankBandFor(undefined, undefined)).toBeNull()
  })
})

describe("timeZoneRegionFor", () => {
  it("buckets US zones by standard offset, so DST never moves one", () => {
    expect(timeZoneRegionFor("America/New_York")).toBe("eastern")
    expect(timeZoneRegionFor("America/Detroit")).toBe("eastern")
    expect(timeZoneRegionFor("America/Indiana/Indianapolis")).toBe("eastern")
    expect(timeZoneRegionFor("America/Chicago")).toBe("central")
    expect(timeZoneRegionFor("America/Denver")).toBe("mountain")
    // No DST in Phoenix; still Mountain, not Pacific, all year.
    expect(timeZoneRegionFor("America/Phoenix")).toBe("mountain")
    expect(timeZoneRegionFor("America/Los_Angeles")).toBe("pacific")
    expect(timeZoneRegionFor("America/Anchorage")).toBe("alaska_hawaii")
    expect(timeZoneRegionFor("Pacific/Honolulu")).toBe("alaska_hawaii")
  })

  it("does not call a same-offset zone outside North America Eastern", () => {
    expect(timeZoneRegionFor("America/Bogota")).toBe("outside_us")
    expect(timeZoneRegionFor("Europe/London")).toBe("outside_us")
  })

  it("is null for a missing or invalid zone", () => {
    expect(timeZoneRegionFor(null)).toBeNull()
    expect(timeZoneRegionFor("")).toBeNull()
    expect(timeZoneRegionFor("Not/A_Zone")).toBeNull()
  })
})

describe("draftFitsWindow", () => {
  // Wednesday 2026-11-04 12:00 UTC.
  const now = new Date("2026-11-04T12:00:00Z")

  it("judges a weeknight on the VIEWER's clock, not the league's", () => {
    // Thursday 2026-11-05 01:30 UTC = Wed 8:30pm Eastern = Wed 5:30pm Pacific.
    const draft = "2026-11-05T01:30:00Z"
    expect(draftFitsWindow(draft, "weeknight", "America/New_York", now)).toBe(true)
    expect(draftFitsWindow(draft, "weeknight", "America/Los_Angeles", now)).toBe(false)
  })

  it("counts Friday evening through Sunday as the weekend", () => {
    // Fri 2026-11-06 7pm Eastern.
    expect(draftFitsWindow("2026-11-07T00:00:00Z", "weekend", "America/New_York", now)).toBe(true)
    // Fri 2026-11-06 noon Eastern — not yet the weekend.
    expect(draftFitsWindow("2026-11-06T17:00:00Z", "weekend", "America/New_York", now)).toBe(false)
    // Sun 2026-11-08 2pm Eastern.
    expect(draftFitsWindow("2026-11-08T19:00:00Z", "weekend", "America/New_York", now)).toBe(true)
  })

  it("never matches a draft that already happened or was never scheduled", () => {
    expect(draftFitsWindow("2026-11-01T00:00:00Z", "upcoming", "America/New_York", now)).toBe(false)
    expect(draftFitsWindow(null, "upcoming", "America/New_York", now)).toBe(false)
    expect(draftFitsWindow("not a date", "weekend", "America/New_York", now)).toBe(false)
  })

  it("'any' lets everything through, including unscheduled drafts", () => {
    expect(draftFitsWindow(null, "any", null, now)).toBe(true)
  })

  it("next 7 days is a week from now, not a calendar week", () => {
    expect(draftFitsWindow("2026-11-10T12:00:00Z", "next_7_days", null, now)).toBe(true)
    expect(draftFitsWindow("2026-11-12T12:00:00Z", "next_7_days", null, now)).toBe(false)
  })
})

describe("matchesSearchText", () => {
  it("needs every word, each starting some word in the fields", () => {
    expect(matchesSearchText(["Dynasty Degenerates", "Kenny"], "dyn degen")).toBe(true)
    expect(matchesSearchText(["Dynasty Degenerates", "Kenny"], "ken")).toBe(true)
    expect(matchesSearchText(["Dynasty Degenerates", "Kenny"], "dynasty bros")).toBe(false)
  })

  it("does not match a number inside another number", () => {
    expect(matchesSearchText(["Est. 2012 League"], "12")).toBe(false)
  })

  it("an empty query matches everything", () => {
    expect(matchesSearchText(["anything"], "  ")).toBe(true)
  })
})

describe("parseLeagueSearch", () => {
  it("reads a plain-English search into filters", () => {
    expect(parseLeagueSearch("12 team dynasty snake, free, weeknights")).toEqual({
      teamCount: 12,
      style: "dynasty",
      draftType: "snake",
      entryFee: "free",
      draftWhen: "weeknight",
      text: "",
    })
  })

  it("keeps words it does not know, so they still narrow by name", () => {
    expect(parseLeagueSearch("nfl superflex best ball")).toEqual({
      sport: "NFL",
      style: "best_ball",
      text: "superflex",
    })
  })

  it("does not count 'college football' as NFL too", () => {
    expect(parseLeagueSearch("college football keeper").sport).toBe("NCAAF")
  })

  it("reads time zones and money words", () => {
    const parsed = parseLeagueSearch("10-team pacific paid auction")
    expect(parsed).toMatchObject({ teamCount: 10, tzRegion: "pacific", entryFee: "paid", draftType: "auction" })
  })

  it("leaves a league-name search alone", () => {
    expect(parseLeagueSearch("Gridiron Gang")).toEqual({ text: "gridiron gang" })
  })

  it("ignores team counts that cannot be real", () => {
    expect(parseLeagueSearch("99 team league").teamCount).toBeUndefined()
  })
})
