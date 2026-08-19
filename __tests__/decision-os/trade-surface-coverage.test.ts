/**
 * Slice 13 — the flip gate must not be blind to a live trade surface.
 *
 * Backstory this guards: the Phase 3 readiness gate shipped measuring four
 * surfaces while the product's HIGHEST-TRAFFIC trade experience (af-legacy,
 * where the dashboard's "Trade Analyzer" tile points) and all five war rooms
 * were uninstrumented. The gate would have reported "ready" on a sample that
 * excluded the surface most users actually touch.
 *
 * This test pins: (1) every declared surface has a flag, (2) every surface
 * that exists in the taxonomy is actually instrumented in a route.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  ALL_TRADE_SURFACES,
  shouldRunTradeSurfaceShadow,
  tradeSurfaceFlagEnvVar,
  type TradeSurface,
} from "@/lib/decision-os/trade/surfaceShadow"

/** Where each surface's instrumentation must live. */
const SURFACE_CALL_SITES: Record<TradeSurface, string> = {
  console: "app/api/trade-value/analyze/route.ts",
  dynasty: "app/api/dynasty-trade-analyzer/route.ts",
  keeper: "app/api/keeper/ai/trade-analysis/route.ts",
  draftpick: "app/api/leagues/[leagueId]/draft/trade-builder/analyze/route.ts",
  legacy: "server/api-route-modules/legacy/trade/analyze/route.ts",
  warroom_redraft: "app/api/leagues/[leagueId]/redraft-war-room/[action]/route.ts",
  warroom_dynasty: "app/api/leagues/[leagueId]/dynasty-war-room/[action]/route.ts",
  warroom_keeper: "app/api/leagues/[leagueId]/keeper-war-room/[action]/route.ts",
  warroom_bestball: "app/api/leagues/[leagueId]/best-ball-war-room/[action]/route.ts",
  warroom_guillotine: "app/api/leagues/[leagueId]/guillotine-war-room/[action]/route.ts",
}

describe("trade surface shadow coverage", () => {
  it("legacy and all five war rooms are part of the taxonomy", () => {
    expect(ALL_TRADE_SURFACES).toContain("legacy")
    for (const format of ["redraft", "dynasty", "keeper", "bestball", "guillotine"]) {
      expect(ALL_TRADE_SURFACES).toContain(`warroom_${format}`)
    }
  })

  it("every surface binds a distinct, well-formed env flag", () => {
    for (const surface of ALL_TRADE_SURFACES) {
      const flag = tradeSurfaceFlagEnvVar(surface)
      expect(flag, surface).toMatch(/^DECISION_OS_TRADE_SHADOW_[A-Z]+$/)
      // Off unless explicitly enabled.
      expect(shouldRunTradeSurfaceShadow(surface, {} as NodeJS.ProcessEnv), surface).toBe(false)
      expect(
        shouldRunTradeSurfaceShadow(surface, { [flag]: "true" } as NodeJS.ProcessEnv),
        surface,
      ).toBe(true)
    }
  })

  it("EVERY surface in the taxonomy is instrumented at its route", () => {
    const missing: string[] = []
    for (const surface of ALL_TRADE_SURFACES) {
      const relative = SURFACE_CALL_SITES[surface]
      const absolute = resolve(process.cwd(), relative)
      if (!existsSync(absolute)) {
        missing.push(`${surface}: route missing at ${relative}`)
        continue
      }
      const source = readFileSync(absolute, "utf8")
      const instrumented =
        source.includes("recordTradeSurfaceShadow") || source.includes("recordWarRoomTradeShadow")
      if (!instrumented) missing.push(`${surface}: ${relative} has no shadow instrumentation`)
    }
    expect(
      missing,
      "A trade surface exists without parity instrumentation — the Phase 3 flip gate would be blind to it. " +
        "Instrument the surface (see AF_TRADE_UNIFICATION_BRIEF Slice 13) rather than deleting this assertion.",
    ).toEqual([])
  })

  it("the call-site map covers the taxonomy exactly (no silent additions)", () => {
    expect(Object.keys(SURFACE_CALL_SITES).sort()).toEqual([...ALL_TRADE_SURFACES].sort())
  })
})
