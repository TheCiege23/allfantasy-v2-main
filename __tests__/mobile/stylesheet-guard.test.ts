import { describe, expect, it } from "vitest"
import {
  diagnoseStylesheets,
  unstyledFailureMessage,
  type CssRequestFailure,
  type StylesheetProbe,
} from "@/e2e/mobile/stylesheetGuard"

/**
 * The positive control for the phone gate's stylesheet guard.
 *
 * `e2e/mobile/phone-smoke.spec.ts` refuses to report geometry from a page that
 * rendered without its CSS. Forcing that red in a real browser needs a dev
 * server, a database, a phone project and a stylesheet request that fails, all
 * at once — the same combination that killed three attempts to prove the target
 * ratchet and produced exit codes rather than verdicts.
 *
 * 🛑 SO THE CONTROL LIVES HERE, AND THE SPEC IMPORTS THE FUNCTION. If anyone
 * reinlines the logic into the spec, every test below keeps passing while
 * guarding nothing — the import is the only thing tying proven code to the gate
 * that runs.
 *
 * ⚠ AND THESE TESTS PROVED THE DECISION WHILE THE GUARD STILL SHIPPED BROKEN,
 * WHICH IS THE MOST IMPORTANT THING IN THIS FILE. Version one passed ten cases
 * here and then went GREEN in CI on the exact failure it was written for,
 * because the tests proved the function and said nothing about the PROBE
 * feeding it. A unit test of a helper is not evidence about the gate — see
 * `PARTIAL_LOSS` below, which is that CI failure expressed as data.
 */

/** A page that is fine: every declared sheet in effect, rules providing `af-` styling. */
const HEALTHY: StylesheetProbe = {
  afElements: 240,
  afRules: 1120,
  sheets: 4,
  unreadableSheets: 0,
  declaredLinks: 4,
  deadLinks: [],
  emptySheets: 0,
}

/** Total loss: classes present, no rules at all, every declared link dead. */
const UNSTYLED: StylesheetProbe = {
  afElements: 240,
  afRules: 0,
  sheets: 1,
  unreadableSheets: 0,
  declaredLinks: 3,
  deadLinks: ["/_next/static/css/app.css", "/_next/static/css/landing.css", "/_next/static/css/core.css"],
  emptySheets: 0,
}

/**
 * 🛑 THE REGRESSION FIXTURE — THE SHAPE THAT DEFEATED VERSION ONE.
 *
 * One sheet of several died. `af-` rules are still present in quantity, so the
 * DOM signal correctly abstains — and the landing page nevertheless rendered
 * without its own stylesheet and was measured as five 20px-wide tap targets.
 * This is the 2026-09-12 `Playwright (mobile-smoke)` failure on PR #714
 * expressed as data, and only the per-sheet signal can see it.
 */
const PARTIAL_LOSS: StylesheetProbe = {
  afElements: 240,
  afRules: 640,
  sheets: 3,
  unreadableSheets: 0,
  declaredLinks: 4,
  deadLinks: ["/_next/static/css/af-landing.css"],
  emptySheets: 0,
}

/** Sheets loaded and non-empty, but none of them provide `af-` rules. */
const WRONG_BUNDLE: StylesheetProbe = {
  afElements: 240,
  afRules: 0,
  sheets: 2,
  unreadableSheets: 0,
  declaredLinks: 2,
  deadLinks: [],
  emptySheets: 0,
}

const failure = (url: string, reason: string): CssRequestFailure => ({ url, reason })

describe("stylesheet guard", () => {
  it("passes a page whose CSS loaded", () => {
    expect(diagnoseStylesheets(HEALTHY, [])).toEqual({ styled: true, reasons: [] })
  })

  /* ─── THE REGRESSION THAT VERSION ONE SHIPPED ─── */

  it("catches ONE dead sheet while other `af-` rules are still in effect", () => {
    /*
     * Version one went green on exactly this input. The DOM signal abstains
     * here and SHOULD — 640 `af-` rules are genuinely in effect. The per-sheet
     * signal is the only thing that can answer, which is why "is any `af-`
     * styling present" was the wrong question to build a guard on.
     */
    const verdict = diagnoseStylesheets(PARTIAL_LOSS, [])
    expect(verdict.styled).toBe(false)
    expect(verdict.reasons).toHaveLength(1)
    expect(verdict.reasons[0]).toContain("af-landing.css")
    expect(verdict.reasons[0]).toContain("1 of 4 declared")
  })

  it("still abstains on the DOM signal in that case, rather than firing for the wrong reason", () => {
    /*
     * ⚠ Pinning WHICH signal fired, not merely that one did. A test asserting
     * only "it went red" would pass with the DOM check wrongly widened to fire
     * whenever any sheet is missing — which would red every route using a
     * partial bundle. The reason text is the assertion.
     */
    const [reason] = diagnoseStylesheets(PARTIAL_LOSS, []).reasons
    expect(reason).not.toContain("rendered without its CSS")
  })

  /* ─── THE OTHER BRANCHES ─── */

  it("catches total loss: document arrived, no stylesheet did", () => {
    const verdict = diagnoseStylesheets(UNSTYLED, [failure("/_next/static/css/app.css", "aborted")])
    expect(verdict.styled).toBe(false)
    /* network + dead links + DOM all fire independently on this input. */
    expect(verdict.reasons).toHaveLength(3)
    expect(verdict.reasons[0]).toContain("aborted")
    expect(verdict.reasons[1]).toContain("3 of 3 declared")
    expect(verdict.reasons[2]).toContain("rendered without its CSS")
  })

  it("fails on a failed stylesheet request ALONE, with everything else healthy", () => {
    const verdict = diagnoseStylesheets(HEALTHY, [failure("/_next/static/css/landing.css", "status 500")])
    expect(verdict.styled).toBe(false)
    expect(verdict.reasons).toHaveLength(1)
    expect(verdict.reasons[0]).toContain("landing.css")
    expect(verdict.reasons[0]).toContain("status 500")
  })

  it("fails on a served-but-EMPTY sheet, which the network layer sees as a clean 200", () => {
    const probe: StylesheetProbe = { ...HEALTHY, emptySheets: 2 }
    const verdict = diagnoseStylesheets(probe, [])
    expect(verdict.styled).toBe(false)
    expect(verdict.reasons).toHaveLength(1)
    expect(verdict.reasons[0]).toContain("ZERO rules")
  })

  it("fails on the DOM contradiction ALONE, with sheets loaded and non-empty", () => {
    const verdict = diagnoseStylesheets(WRONG_BUNDLE, [])
    expect(verdict.styled).toBe(false)
    expect(verdict.reasons).toHaveLength(1)
    expect(verdict.reasons[0]).toContain("ZERO `af-` rules")
  })

  /* ─── THE ABSTAIN CASES: A NEGATIVE NOBODY WAS ENTITLED TO ASSERT ─── */

  it("does NOT fire on a route that uses no `af-` classes at all", () => {
    const probe: StylesheetProbe = { ...HEALTHY, afElements: 0, afRules: 0 }
    expect(diagnoseStylesheets(probe, [])).toEqual({ styled: true, reasons: [] })
  })

  it("does NOT fire when a cross-origin sheet made the rules unreadable", () => {
    /*
     * 🛑 THE LESSON THIS LANE PAID FOR TWICE. `cssRules` throws on an opaque
     * sheet, so `afRules === 0` means "could not look", not "not there" — an
     * absence measured through an instrument that could not have seen the
     * thing. The DOM signal abstains; every other signal still applies.
     */
    const probe: StylesheetProbe = { ...HEALTHY, afRules: 0, unreadableSheets: 1 }
    expect(diagnoseStylesheets(probe, [])).toEqual({ styled: true, reasons: [] })
  })

  it("still reports a network failure while the DOM signal is abstaining", () => {
    const probe: StylesheetProbe = { ...HEALTHY, afElements: 0, afRules: 0, unreadableSheets: 1 }
    const verdict = diagnoseStylesheets(probe, [failure("/a.css", "aborted")])
    expect(verdict.styled).toBe(false)
    expect(verdict.reasons).toHaveLength(1)
  })

  it("still reports a dead link while the DOM signal is abstaining", () => {
    /* The abstention is scoped to the DOM check and must not mute the others. */
    const probe: StylesheetProbe = { ...PARTIAL_LOSS, afElements: 0, afRules: 0, unreadableSheets: 1 }
    const verdict = diagnoseStylesheets(probe, [])
    expect(verdict.styled).toBe(false)
    expect(verdict.reasons).toHaveLength(1)
    expect(verdict.reasons[0]).toContain("declared")
  })

  /* ─── REPORTING ─── */

  it("names the first few failing URLs and counts the rest", () => {
    const many = Array.from({ length: 9 }, (_, i) => failure(`/css/${i}.css`, "aborted"))
    const [reason] = diagnoseStylesheets(HEALTHY, many).reasons
    expect(reason).toContain("9 stylesheet request(s) failed")
    expect(reason).toContain("/css/0.css")
    expect(reason).toContain("/css/4.css")
    expect(reason).not.toContain("/css/5.css")
    expect(reason).toContain("and 4 more")
  })

  it("caps named dead links the same way", () => {
    const probe: StylesheetProbe = {
      ...HEALTHY,
      declaredLinks: 9,
      deadLinks: Array.from({ length: 7 }, (_, i) => `/css/dead${i}.css`),
    }
    const [reason] = diagnoseStylesheets(probe, []).reasons
    expect(reason).toContain("7 of 9 declared")
    expect(reason).toContain("/css/dead4.css")
    expect(reason).not.toContain("/css/dead5.css")
    expect(reason).toContain("and 2 more")
  })

  it("does not say 'and N more' when every failure is named", () => {
    const [reason] = diagnoseStylesheets(HEALTHY, [failure("/only.css", "aborted")]).reasons
    expect(reason).not.toContain("more")
  })

  it("tells the reader not to act on the geometry", () => {
    /*
     * ⚠ THIS ASSERTION IS THE POINT OF THE WHOLE FILE, NOT A COPY TEST. The
     * failure mode being guarded is that a red lane reads as product debt and
     * sends someone to edit innocent CSS — which a peer proposed in good faith
     * from this lane's output. If the message stops saying so, the guard still
     * fires and the day still gets wasted.
     */
    const msg = unstyledFailureMessage("/", diagnoseStylesheets(PARTIAL_LOSS, []))
    expect(msg).toContain("environment failure, not a product defect")
    expect(msg).toMatch(/do NOT/i)
    expect(msg).toContain("/ rendered WITHOUT its stylesheet")
    expect(msg).toContain("af-landing.css")
  })
})
