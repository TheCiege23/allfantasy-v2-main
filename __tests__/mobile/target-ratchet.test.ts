import { describe, expect, it } from "vitest"
import {
  compareTargets,
  targetKey,
  type BaselineTarget,
  type MeasuredTarget,
} from "@/e2e/mobile/targetRatchet"
import baselineFile from "@/e2e/mobile/undersized-target-baseline.json"

/**
 * The positive control for the phone gate's ratchet.
 *
 * `e2e/mobile/phone-smoke.spec.ts` fails a PR when a public route gains a
 * control under 44x44. That assertion had never once been seen red for the right
 * reason — three attempts to force it in a browser were each killed by the
 * environment instead (a `--grep` mangled by MSYS into a Windows path, exiting 1
 * with "No tests found"; a dev-server 500; a box too slow to finish). Exit codes
 * 1, 1 and none, and not one of them was a verdict about the ratchet.
 *
 * 🛑 SO THE CONTROL LIVES HERE, WHERE IT COSTS MILLISECONDS AND CANNOT BE
 * STARVED. A guard whose control needs a browser, a dev server, a database and
 * an unlucky page is a guard whose control does not get run.
 */

const target = (cls: string, label: string, w = 20, h = 20): MeasuredTarget => ({
  tag: "button",
  cls,
  label,
  w,
  h,
})

describe("undersized-target ratchet", () => {
  it("passes when what is measured is exactly what is baselined", () => {
    const found = [target("af-pr-toggle-btn", "Monthly")]
    const baseline: BaselineTarget[] = [{ cls: "af-pr-toggle-btn", label: "Monthly" }]
    expect(compareTargets(found, baseline)).toEqual({ regressions: [], stale: [] })
  })

  /* THE BRANCH THAT COULD NOT BE PROVEN IN A BROWSER. */
  it("REGRESSION: reports a control that is undersized and not baselined", () => {
    const fresh = target("af-brand-new-cta", "Start free trial", 120, 30)
    const { regressions, stale } = compareTargets(
      [target("af-pr-toggle-btn", "Monthly"), fresh],
      [{ cls: "af-pr-toggle-btn", label: "Monthly" }],
    )
    expect(regressions).toEqual([fresh])
    expect(stale).toEqual([])
  })

  it("STALE: reports a baseline entry whose control is no longer undersized", () => {
    const { regressions, stale } = compareTargets(
      [],
      [{ cls: "af-lp-signin", label: "Sign in" }],
    )
    expect(stale).toEqual(["af-lp-signin|Sign in"])
    expect(regressions).toEqual([])
  })

  it("reports both at once rather than stopping at the first", () => {
    const fresh = target("af-new", "New")
    const { regressions, stale } = compareTargets([fresh], [{ cls: "af-old", label: "Old" }])
    expect(regressions).toEqual([fresh])
    expect(stale).toEqual(["af-old|Old"])
  })

  /*
   * Identity deliberately excludes size: a baselined control that shrinks
   * FURTHER must still match, or routine CSS churn on known debt would read as
   * a new defect and train people to re-baseline.
   */
  it("a baselined control that shrinks further is not a new regression", () => {
    const { regressions } = compareTargets(
      [target("af-pr-toggle-btn", "Monthly", 40, 12)],
      [{ cls: "af-pr-toggle-btn", label: "Monthly", seen: "86x27" }],
    )
    expect(regressions).toEqual([])
  })

  it("distinguishes two controls that share a class but not a label", () => {
    const yearly = target("af-pr-toggle-btn", "Yearly")
    const { regressions } = compareTargets(
      [target("af-pr-toggle-btn", "Monthly"), yearly],
      [{ cls: "af-pr-toggle-btn", label: "Monthly" }],
    )
    expect(regressions).toEqual([yearly])
  })

  it("an empty baseline makes every measured control a regression", () => {
    const found = [target("a", "A"), target("b", "B")]
    expect(compareTargets(found, []).regressions).toEqual(found)
  })
})

/**
 * The committed baseline is an input to a gate, so its shape is load-bearing.
 * A typo in a route key silently produces `undefined`, which the spec reads as
 * "no baseline for this route" — turning every known control on that route into
 * a regression, or (if the route were dropped) hiding them all.
 */
describe("committed baseline file", () => {
  const baseline = baselineFile as unknown as {
    routes: Record<string, BaselineTarget[]>
  }

  it("covers exactly the routes the smoke spec visits", () => {
    expect(Object.keys(baseline.routes).sort()).toEqual(["/", "/login", "/pricing"])
  })

  it("has no duplicate identities within a route", () => {
    for (const [route, entries] of Object.entries(baseline.routes)) {
      const keys = entries.map(targetKey)
      expect(new Set(keys).size, `${route} has duplicate baseline entries`).toBe(keys.length)
    }
  })

  it("gives every entry a non-empty class and label", () => {
    for (const [route, entries] of Object.entries(baseline.routes)) {
      for (const e of entries) {
        expect(typeof e.cls, `${route}: cls must be a string`).toBe("string")
        expect(e.cls.length, `${route}: empty cls`).toBeGreaterThan(0)
        expect(typeof e.label, `${route}: label must be a string`).toBe("string")
      }
    }
  })

  /*
   * ⚠ A RATCHET IS ONLY A RATCHET WHILE IT SHRINKS. This pins the debt at the
   * count measured when the lane was switched on, so ADDING an entry needs a
   * deliberate edit here and cannot be slipped in to make a red run green.
   * Lowering it is the expected direction and is what fixing a control looks
   * like.
   */
  /*
   * Ratcheted 11 -> 6 on 2026-09-11 when the landing hero/header CTAs and the
   * pricing billing toggle were fixed. Lowering this number is what fixing a
   * control looks like; raising it needs a deliberate edit and a reason.
   */
  it("holds no more known debt than the last time this was ratcheted down", () => {
    const total = Object.values(baseline.routes).reduce((n, e) => n + e.length, 0)
    expect(total).toBeLessThanOrEqual(6)
  })
})
