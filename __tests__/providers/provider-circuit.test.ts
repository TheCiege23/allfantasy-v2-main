import fs from "node:fs"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  __resetProviderCircuits,
  isCircuitFailureStatus,
  isProviderCircuitOpen,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/providers/provider-circuit"

/**
 * Blocker B12 — "provider budget/circuit-breaker absent for fantasy providers".
 *
 * The behaviour that matters is not "a breaker exists" but the two ways a breaker
 * makes things WORSE than having none:
 *   - opening on traffic that is actually healthy (Sleeper 404s every week past the
 *     end of a season), which halts real imports for a non-problem;
 *   - never opening, which is the same as not being wired at all.
 * Both are asserted below, and the wiring itself is guarded by reading the source.
 */

const OPTS = { threshold: 3, cooldownMs: 1000 }

beforeEach(() => {
  __resetProviderCircuits()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-05T12:00:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
  __resetProviderCircuits()
})

describe("provider circuit", () => {
  it("starts closed", () => {
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(false)
  })

  it("stays closed below the threshold, opens at it", () => {
    recordProviderFailure("sleeper", OPTS)
    recordProviderFailure("sleeper", OPTS)
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(false)
    recordProviderFailure("sleeper", OPTS)
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(true)
  })

  it("a success clears the count outright", () => {
    recordProviderFailure("sleeper", OPTS)
    recordProviderFailure("sleeper", OPTS)
    recordProviderSuccess("sleeper")
    recordProviderFailure("sleeper", OPTS)
    recordProviderFailure("sleeper", OPTS)
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(false)
  })

  it("closes once the cooldown elapses", () => {
    for (let i = 0; i < 3; i++) recordProviderFailure("sleeper", OPTS)
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(true)
    vi.advanceTimersByTime(1001)
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(false)
  })

  it("re-opens on the NEXT failure, not after another full threshold", () => {
    // A provider that is still down must not need a fresh burst of traffic to be
    // re-detected — that is how a breaker becomes a periodic outage amplifier.
    for (let i = 0; i < 3; i++) recordProviderFailure("sleeper", OPTS)
    vi.advanceTimersByTime(1001)
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(false)
    recordProviderFailure("sleeper", OPTS)
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(true)
  })

  it("is per-provider — one failing host does not pause another", () => {
    for (let i = 0; i < 3; i++) recordProviderFailure("sleeper", OPTS)
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(true)
    expect(isProviderCircuitOpen("espn", OPTS)).toBe(false)
  })

  it("normalizes provider names", () => {
    for (let i = 0; i < 3; i++) recordProviderFailure("  Sleeper ", OPTS)
    expect(isProviderCircuitOpen("sleeper", OPTS)).toBe(true)
  })
})

describe("which statuses count", () => {
  it("429 and 5xx count", () => {
    expect(isCircuitFailureStatus(429)).toBe(true)
    expect(isCircuitFailureStatus(500)).toBe(true)
    expect(isCircuitFailureStatus(503)).toBe(true)
  })

  it("🛑 404 does NOT count — it is a healthy answer, not an outage", () => {
    // Sleeper returns 404 for every week past the end of a season. Counting those
    // would open the circuit during an entirely normal sync and stop real imports.
    expect(isCircuitFailureStatus(404)).toBe(false)
    expect(isCircuitFailureStatus(200)).toBe(false)
    expect(isCircuitFailureStatus(400)).toBe(false)
  })
})

describe("the Sleeper ingestion path is actually wired to it", () => {
  // A primitive nothing calls is the failure mode this repo keeps repeating — the
  // dashboard league-selection helper shipped that way and sat dead. Read the source
  // rather than trusting that the import exists.
  const SRC = path.resolve(process.cwd(), "lib/league-import/sleeper/SleeperLeagueFetchService.ts")
  const src = fs.readFileSync(SRC, "utf8")

  it("finds the file (positive control for the reader)", () => {
    expect(src.length).toBeGreaterThan(1000)
  })

  it("checks the circuit before spending retries", () => {
    expect(src).toMatch(/isProviderCircuitOpen\(\s*'sleeper'\s*\)/)
  })

  it("records both outcomes", () => {
    expect(src).toMatch(/recordProviderSuccess\(\s*'sleeper'\s*\)/)
    expect(src).toMatch(/recordProviderFailure\(\s*'sleeper'\s*\)/)
  })

  it("gates the status count so a 404 cannot open the circuit", () => {
    expect(src).toMatch(/isCircuitFailureStatus\(res\.status\)\s*&&|if \(isCircuitFailureStatus\(res\.status\)\)/)
  })
})
