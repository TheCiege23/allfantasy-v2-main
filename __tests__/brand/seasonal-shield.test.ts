import { describe, expect, it } from "vitest"
import {
  brandSeasonFor,
  brandShieldSrc,
  holidaySaleShieldSrc,
  resolveBrandShieldSrc,
  isFiftyPercentOffer,
  saleArtFor,
  seasonalShieldSrc,
  PLAIN_SHIELD_SRC,
} from "@/lib/brand/seasonalShield"

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

describe("saleArtFor", () => {
  // Thanksgiving 2026 is Thu Nov 26; 2027 is Thu Nov 25; 2029 is Thu Nov 22.
  it.each([
    ["2026-11-26", null], // Thanksgiving itself
    ["2026-11-27", "gold"], // Black Friday
    ["2026-11-29", "gold"], // Sunday
    ["2026-11-30", "cyber"], // Cyber Monday
    ["2026-12-01", "holiday"],
    ["2026-12-25", "holiday"],
    ["2026-12-26", null],
    ["2027-11-26", "gold"],
    ["2027-11-29", "cyber"],
    ["2029-11-23", "gold"],
    ["2029-11-26", "cyber"],
    ["2026-07-04", null],
  ] as const)("%s -> %s", (iso, art) => {
    expect(saleArtFor(day(iso))).toBe(art)
  })
})

describe("isFiftyPercentOffer", () => {
  it.each([
    ["50% off AF Pro for life", true],
    ["Founding members: 50 % off", true],
    ["150% value", false],
    ["25% off AF Pro", false],
    ["Half price", false],
    ["", false],
  ] as const)("%j -> %s", (label, ok) => {
    expect(isFiftyPercentOffer(label)).toBe(ok)
  })
  it("is false for a missing label", () => {
    expect(isFiftyPercentOffer(null)).toBe(false)
    expect(isFiftyPercentOffer(undefined)).toBe(false)
  })
})

describe("brandShieldSrc — the sale art is a promise, so it needs a real 50% offer", () => {
  const blackFriday = day("2026-11-27")
  const fifty = { label: "50% off AF Pro for life" }

  it("shows the sale art only with a 50% founding offer in a sale window", () => {
    expect(brandShieldSrc({ date: blackFriday, founding: fifty })).toBe("/brand/sale/af-shield-sale-gold.webp")
    expect(brandShieldSrc({ date: day("2026-11-30"), founding: fifty })).toBe("/brand/sale/af-shield-sale-cyber.webp")
    expect(brandShieldSrc({ date: day("2026-12-10"), founding: fifty })).toBe("/brand/sale/af-shield-sale-holiday.webp")
  })

  it("falls back to the seasonal shield without an offer, without a label, or with another figure", () => {
    const fall = "/brand/seasonal/af-shield-fall.webp"
    expect(brandShieldSrc({ date: blackFriday, founding: null })).toBe(fall)
    expect(brandShieldSrc({ date: blackFriday, founding: undefined })).toBe(fall)
    expect(brandShieldSrc({ date: blackFriday, founding: { label: null } })).toBe(fall)
    expect(brandShieldSrc({ date: blackFriday, founding: { label: "25% off" } })).toBe(fall)
  })

  it("outside a sale window a 50% offer still shows the seasonal shield", () => {
    expect(brandShieldSrc({ date: day("2026-10-10"), founding: fifty })).toBe("/brand/seasonal/af-shield-fall.webp")
    expect(brandShieldSrc({ date: day("2027-03-01"), founding: fifty })).toBe(PLAIN_SHIELD_SRC)
  })
})

describe("holidaySaleShieldSrc — follows the sale banner's own name", () => {
  it("is gold for Black Friday and cyber for Cyber Monday", () => {
    expect(holidaySaleShieldSrc("Black Friday")).toBe("/brand/sale/af-shield-sale-gold.webp")
    expect(holidaySaleShieldSrc("Cyber Monday")).toBe("/brand/sale/af-shield-sale-cyber.webp")
  })
})

describe("resolveBrandShieldSrc — the sale art is web-only", () => {
  const sat = day("2026-11-28") // Saturday of the Black Friday sale
  const sale = { percentOff: 50 }
  const fall = "/brand/seasonal/af-shield-fall.webp"
  const gold = "/brand/sale/af-shield-sale-gold.webp"

  it("NEVER shows sale art inside the iOS / Android app, even mid-sale with a 50% founding offer", () => {
    expect(
      resolveBrandShieldSrc({
        now: sat,
        onWeb: false,
        holidaySale: sale,
        holidaySaleName: "Black Friday",
        founding: { label: "50% off AF Pro for life" },
      }),
    ).toBe(fall)
  })

  it("shows the holiday sale art on the web while the sale is live", () => {
    expect(resolveBrandShieldSrc({ now: sat, onWeb: true, holidaySale: sale, holidaySaleName: "Black Friday" })).toBe(gold)
    expect(
      resolveBrandShieldSrc({ now: day("2026-11-30"), onWeb: true, holidaySale: sale, holidaySaleName: "Cyber Monday" }),
    ).toBe("/brand/sale/af-shield-sale-cyber.webp")
  })

  it("no sale (ended, or killed by NEXT_PUBLIC_HOLIDAY_SALE_DISABLED) → seasonal, unless a founding 50% offer", () => {
    expect(resolveBrandShieldSrc({ now: sat, onWeb: true, holidaySale: null, holidaySaleName: "Black Friday" })).toBe(fall)
    expect(
      resolveBrandShieldSrc({
        now: day("2026-12-10"),
        onWeb: true,
        holidaySale: null,
        holidaySaleName: "Cyber Monday",
        founding: { label: "50% off AF Pro for life" },
      }),
    ).toBe("/brand/sale/af-shield-sale-holiday.webp")
  })

  it("a sale at a different percentage never shows 50% OFF art", () => {
    expect(
      resolveBrandShieldSrc({ now: sat, onWeb: true, holidaySale: { percentOff: 30 }, holidaySaleName: "Black Friday" }),
    ).toBe(fall)
  })
})
