import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { getMonetizationCatalogItemBySku } from "@/lib/monetization/catalog"
import { priceOf, TIER_PRICE } from "@/lib/monetization/priceOf"
import { NOCTURNE_COPY } from "@/components/landing/nocturne/copy"

/**
 * Prices were hardcoded in six customer-facing files. They all happened to match the
 * catalog — but only because someone remembered to update each one after the July 2026
 * reprice. These tests lock in the two things that matter:
 *
 *   1. Deriving from the catalog produces EXACTLY the strings that used to be hardcoded,
 *      so this refactor changed no rendered price. A wrong SKU mapping (e.g. Legacy
 *      pointed at Commissioner) would show up here rather than on the live page.
 *   2. No customer-facing file reintroduces a literal.
 */

/** The exact strings that were hardcoded before this change. */
const PREVIOUSLY_HARDCODED = {
  proMonthly: "$9.99",
  commissionerMonthly: "$14.99",
  commissionerYearly: "$149.99",
  legacyMonthly: "$29.99",
  legacyYearly: "$299.99",
  supremeMonthly: "$19.99",
  supremeYearly: "$199.99",
} as const

describe("prices derive from the catalog", () => {
  it("renders exactly what was hardcoded before (no visual change)", () => {
    for (const [key, expected] of Object.entries(PREVIOUSLY_HARDCODED)) {
      expect(TIER_PRICE[key as keyof typeof PREVIOUSLY_HARDCODED], key).toBe(expected)
    }
  })

  it("tracks the catalog rather than a copy of it", () => {
    // If someone reprices the catalog, this is the assertion that proves the copy follows.
    expect(TIER_PRICE.commissionerMonthly).toBe(
      `$${getMonetizationCatalogItemBySku("af_commissioner_monthly")!.amountUsd}`,
    )
    // af_war_room is the internal key for the tier customers see as "Legacy".
    expect(TIER_PRICE.legacyMonthly).toBe(
      `$${getMonetizationCatalogItemBySku("af_war_room_monthly")!.amountUsd}`,
    )
  })

  it("degrades to a dash rather than rendering NaN or undefined", () => {
    expect(priceOf("definitely_not_a_sku" as never)).toBe("—")
  })
})

describe("the LIVE landing page reads through", () => {
  it("shows catalog prices in the pricing section", () => {
    const pricing = JSON.stringify(NOCTURNE_COPY.pricing ?? NOCTURNE_COPY)
    expect(pricing).toContain(TIER_PRICE.commissionerMonthly)
    expect(pricing).toContain(TIER_PRICE.legacyMonthly)
  })

  it("shows a catalog price in the hero fine print", () => {
    expect(NOCTURNE_COPY.hero.finePrint).toContain(TIER_PRICE.commissionerMonthly)
  })
})

describe("no customer-facing file reintroduces a hardcoded price", () => {
  // Files converted away from literals. Adding a file here is how you extend the guard.
  const GUARDED = [
    "components/landing/nocturne/copy.ts",
    "components/landing/journey/copy.ts",
    "components/monetization/AFSupremeBundleSpotlight.tsx",
    "app/dashboard/components/LegacyToolsetGrid.tsx",
    "app/world-cup/page.tsx",
    "components/brackets/world-cup/WorldCupBracketShell.tsx",
  ]

  it("guards a non-empty set of real files", () => {
    // Without this, a renamed file silently drops out and the scan below passes on nothing.
    expect(GUARDED.length).toBeGreaterThan(0)
    for (const rel of GUARDED) {
      expect(() => readFileSync(resolve(process.cwd(), rel), "utf8"), rel).not.toThrow()
    }
  })

  it("contains no hardcoded copy of a catalog price", () => {
    // Deliberately matches CATALOG amounts, not any `$<digits>`. A blanket digit rule
    // flags the `$0` free tier and the FAAB bid amounts in the landing mockups
    // (`bid: '$18'`), which are not product prices and must stay literal. What actually
    // drifts is a copy of a real tier price.
    //
    // No false substring hits: "$19.99" does not contain "$9.99" (the `$` precedes the
    // 1), and "$199.99" does not contain "$99.99". `${TIER_PRICE.x}` is `$` + `{`.
    const catalogPrices = Object.values(TIER_PRICE)
    const offenders: string[] = []

    for (const rel of GUARDED) {
      const src = readFileSync(resolve(process.cwd(), rel), "utf8")
      for (const [i, line] of src.split(/\r?\n/).entries()) {
        const trimmed = line.trim()
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue
        if (catalogPrices.some((p) => line.includes(p))) {
          offenders.push(`${rel}:${i + 1}  ${trimmed}`)
        }
      }
    }

    expect(offenders, `Hardcoded price literals found:\n${offenders.join("\n")}`).toEqual([])
  })
})
