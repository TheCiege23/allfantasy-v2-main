import { describe, expect, it } from "vitest"
import { brandSeasonFor, seasonalShieldSrc, PLAIN_SHIELD_SRC } from "@/lib/brand/seasonalShield"

// Noon Eastern on the given day, written as UTC (EST = UTC-5, EDT = UTC-4;
// 17:00Z is midday Eastern either way).
const day = (iso: string) => new Date(`${iso}T17:00:00Z`)

describe("brandSeasonFor", () => {
  it.each([
    ["2026-09-30", null],
    ["2026-10-01", "fall"],
    ["2026-11-28", "fall"],
    ["2026-11-30", "fall"],
    ["2026-12-01", "winter"],
    ["2026-12-25", "winter"],
    ["2026-12-30", "winter"],
    ["2026-12-31", "newyear"],
    ["2027-01-01", "newyear"],
    ["2027-01-07", "newyear"],
    ["2027-01-08", null],
    ["2027-06-15", null],
    ["2027-10-15", "fall"],
    ["2027-12-31", null], // the art says 2027 — never reused
    ["2028-01-01", null],
  ] as const)("%s -> %s", (iso, season) => {
    expect(brandSeasonFor(day(iso))).toBe(season)
  })

  it("switches on the US Eastern date, not UTC", () => {
    // 03:00Z on Dec 1 is still Nov 30 (22:00) in New York.
    expect(brandSeasonFor(new Date("2026-12-01T03:00:00Z"))).toBe("fall")
    expect(brandSeasonFor(new Date("2026-12-01T06:00:00Z"))).toBe("winter")
  })
})

describe("seasonalShieldSrc", () => {
  it("returns the seasonal file in season and the plain shield otherwise", () => {
    expect(seasonalShieldSrc(day("2026-11-28"))).toBe("/brand/seasonal/af-shield-fall.webp")
    expect(seasonalShieldSrc(day("2026-12-24"))).toBe("/brand/seasonal/af-shield-winter.webp")
    expect(seasonalShieldSrc(day("2027-01-01"))).toBe("/brand/seasonal/af-shield-newyear.webp")
    expect(seasonalShieldSrc(day("2027-03-01"))).toBe(PLAIN_SHIELD_SRC)
  })
})
