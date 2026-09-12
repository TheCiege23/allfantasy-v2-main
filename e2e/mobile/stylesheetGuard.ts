/**
 * Did the page under test actually get its stylesheet?
 *
 * 🛑 WHY THIS EXISTS: ON 2026-09-11 THIS LANE SPENT A DAY REPORTING SEVEN
 * "UNDERSIZED CONTROLS" ON `/` THAT DO NOT EXIST. The CI dev server hit its
 * memory ceiling mid-run, three responses came back `ECONNRESET`, and the spec
 * measured a landing page that had rendered with NO CSS APPLIED. The log, in
 * order:
 *
 *   21:13:52  [WebServer] Server is approaching the used memory threshold, restarting...
 *   21:17:18  [WebServer] Error: aborted    code: 'ECONNRESET'   (x3)
 *   21:17:23  page.goto: Test timeout of 180000ms exceeded
 *   21:17:23  / gained 7 controls under 44x44
 *
 * The seven were five nav links reported at **20px wide** and 58-78px tall —
 * which is "How it works" wrapping ONE CHARACTER PER LINE, not a small button —
 * plus the EN/ES pills. `.af-lp-nav-links` and `.af-lp-nav-right` are
 * `display: none` below 720px and the device is 393px, so with the real
 * stylesheet those elements cannot be measured at all.
 *
 * ⚠ THE EXISTING `response.status() < 400` GUARD CANNOT CATCH THIS, and that is
 * the whole reason a second guard is needed. A restart mid-run still returns
 * **200** for the document; it is the SUBRESOURCES that die. Guarding the
 * document's status checks that the server answered, not that the page is the
 * page.
 *
 * 🛑 AND THE FAILURE IS WORSE THAN A FLAKE, BECAUSE IT IS ARTICULATE. An
 * unstyled page does not throw. It produces a geometry report that is internally
 * consistent, names real elements, and reads exactly like product debt — so the
 * lane's own error message tells you to go and put `min-height: 44px` on CSS
 * that is not at fault. A peer proposed precisely that fix, in good faith, from
 * the lane's output. The point of this file is that the gate says "the page
 * rendered unstyled" instead of inventing work.
 */

/** A stylesheet request that never delivered — aborted, refused, or an error status. */
export type CssRequestFailure = {
  url: string
  /** `aborted`, `net::ERR_CONNECTION_REFUSED`, `status 500` — whatever the driver reported. */
  reason: string
}

/** What the page says about its own styling, gathered in one `page.evaluate`. */
export type StylesheetProbe = {
  /** Elements carrying at least one `af-`-prefixed class. */
  afElements: number
  /** Rules IN EFFECT whose selector mentions an `af-` class, media queries included. */
  afRules: number
  /** `document.styleSheets.length`. Diagnostic only — see the note below. */
  sheets: number
  /**
   * Sheets whose `cssRules` threw AND whose href is CROSS-ORIGIN — opaque by
   * design, so their rules are unreadable rather than absent.
   *
   * ⚠ A SAME-ORIGIN SHEET THAT THROWS IS NOT COUNTED HERE; it is a dead sheet
   * and appears in `deadLinks`. Version one counted both, so a stylesheet our
   * own server failed to deliver looked like a legitimate opaque sheet and
   * tripped the abstain condition below — silencing the guard on the exact
   * failure it was written for.
   */
  unreadableSheets: number
  /**
   * `<link rel="stylesheet">` elements the document declares.
   *
   * 🛑 `deadLinks` IS THE SIGNAL THE FIRST VERSION OF THIS FILE LACKED, AND ITS
   * ABSENCE IS WHY THE GUARD WENT GREEN ON THE VERY FAILURE IT WAS WRITTEN FOR.
   * On the first CI run carrying it, `/` was measured unstyled again — same
   * `[WebServer] Error: aborted`, same five nav links at 20px — and this guard
   * said nothing. It asked "is ANY `.af-` rule in effect", which is true whenever
   * one sheet of several survives, and the landing sheet was the one that died.
   *
   * The right question is per-sheet: a `<link>` the document ASKED for whose
   * `.sheet` is null is a stylesheet that is declared and not in effect. That is
   * specific, needs no knowledge of which rules matter, and cannot be satisfied
   * by an unrelated sheet loading.
   */
  declaredLinks: number
  /** Hrefs of `<link rel="stylesheet">` elements with a null `.sheet`. */
  deadLinks: string[]
  /**
   * Same-origin sheets that parsed to ZERO rules — served, readable, and empty.
   * A truncated or error-bodied response looks like this, and the network layer
   * sees a clean 200.
   */
  emptySheets: number
}

export type StylesheetVerdict = {
  styled: boolean
  /** Empty when styled. One human-readable line per independent signal otherwise. */
  reasons: string[]
}

/** How many failing URLs to name before summarising; a restart can fail dozens at once. */
const MAX_NAMED_FAILURES = 5

/**
 * Gather the probe from inside the page. Passed to `page.evaluate`, so it must
 * be SELF-CONTAINED — no imports, no closure over module scope, or Playwright's
 * serialisation drops the reference and it throws at runtime.
 *
 * 🛑 IT LIVES HERE, EXPORTED, SO IT CAN BE TESTED AGAINST A REAL BROWSER.
 * Version one kept this inline in the spec, which made it untestable, and that
 * is the whole reason the guard shipped broken: fifteen unit tests proved the
 * DECISION and nothing proved the INPUTS, so a probe that could not distinguish
 * one dead sheet from a healthy page sailed through review and went green in CI
 * on the exact failure it was written for. `stylesheet-probe.spec.ts` drives
 * this function with `page.setContent` — no dev server, no database — and is
 * the control that was missing.
 *
 * ⚠ Do NOT reimplement it in the spec. Two implementations of one rule is the
 * bug; the export is what keeps the tested code and the running code identical.
 */
export function probeStylesheets(): StylesheetProbe {
  let afRules = 0
  let emptySheets = 0
  /*
   * Sheets that threw AND are genuinely cross-origin. Only these justify the
   * DOM signal abstaining — a same-origin thrower is a dead sheet and is
   * reported as one, which is the distinction version one collapsed.
   */
  let opaqueSheets = 0

  const countAfRules = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      /* `.af-`, not `af-`: a bare substring also matches `.leaf-row`. */
      const selector = (rule as CSSStyleRule).selectorText
      if (typeof selector === "string" && selector.includes(".af-")) afRules++
      /* Rules inside `@media` / `@supports` are where the phone rules live. */
      const nested = (rule as CSSGroupingRule).cssRules
      if (nested) countAfRules(nested)
    }
  }

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules
      if (!rules) continue
      /* Served, readable, and empty — a truncated body looks exactly like this. */
      if (rules.length === 0) emptySheets++
      countAfRules(rules)
    } catch {
      /*
       * Classified by the LINK loop below, which can see the href and therefore
       * the origin. Counting it here would merge "cross-origin and fine" with
       * "same-origin and dead" — the exact conflation that silenced version one.
       */
    }
  }

  let afElements = 0
  document.querySelectorAll("[class]").forEach((el) => {
    /* SVG elements carry an SVGAnimatedString, not a string. */
    const cls = typeof el.className === "string" ? el.className : String(el.getAttribute("class") || "")
    if (cls.split(/\s+/).some((c) => c.startsWith("af-"))) afElements++
  })

  /*
   * 🛑 A FAILED STYLESHEET LINK DOES NOT HAVE A NULL `.sheet`. MEASURED, AFTER
   * ASSUMING OTHERWISE AND SHIPPING IT.
   *
   *   sheetIsNull  false          <- the obvious test cannot fire
   *   sheetType    [object CSSStyleSheet]
   *   cssRules     THROWS
   *
   * Chromium attaches a CSSStyleSheet whose rules are inaccessible, which is
   * byte-for-byte the same shape as a legitimately opaque CROSS-ORIGIN sheet.
   * So "it threw" cannot distinguish "never loaded" from "loaded, not readable"
   * — and version one counted both as `unreadableSheets`, which tripped its own
   * abstain condition and muted the DOM signal as well. The care taken to avoid
   * asserting a negative without a control is exactly what blinded the guard.
   *
   * ⚠ THE ORIGIN IS THE DISCRIMINATOR. A SAME-ORIGIN sheet that throws did not
   * load: our own server either failed to serve it or served something
   * unparseable. A CROSS-ORIGIN one that throws is working as designed.
   */
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[]
  const deadLinks: string[] = []
  for (const l of links) {
    const href = l.getAttribute("href") || "(no href)"
    let sameOrigin = true
    try {
      sameOrigin = new URL(l.href, document.baseURI).origin === location.origin
    } catch {
      /* Unparseable href: treat as ours rather than silently excusing it. */
      sameOrigin = true
    }
    const sheet = l.sheet
    if (!sheet) {
      deadLinks.push(href)
      continue
    }
    try {
      void sheet.cssRules
    } catch {
      if (sameOrigin) deadLinks.push(href)
      else opaqueSheets++
    }
  }

  return {
    afElements,
    afRules,
    sheets: document.styleSheets.length,
    unreadableSheets: opaqueSheets,
    declaredLinks: links.length,
    deadLinks,
    emptySheets,
  }
}

/**
 * Decide whether the page was styled when it was measured.
 *
 * Pure on purpose — see the note in `phone-smoke.spec.ts` about `targetRatchet.ts`.
 * Forcing this branch red in a real browser needs a dev server, a database, a
 * phone project AND a stylesheet that fails to load, all at once. That
 * combination defeated three attempts at the target ratchet for purely
 * environmental reasons and never once established whether the branch worked.
 * As a function it is proven both ways in milliseconds by
 * `__tests__/mobile/stylesheet-guard.test.ts`.
 */
export function diagnoseStylesheets(
  probe: StylesheetProbe,
  failures: CssRequestFailure[],
): StylesheetVerdict {
  const reasons: string[] = []

  /*
   * Signal 1 — the network. This is the direct observation of the 2026-09-11
   * cause: the request for the stylesheet did not complete. It stands alone and
   * needs no corroboration from the DOM, because a stylesheet that never
   * arrived cannot be applied whatever the page looks like afterwards.
   */
  if (failures.length > 0) {
    const named = failures
      .slice(0, MAX_NAMED_FAILURES)
      .map((f) => `${f.url} (${f.reason})`)
      .join(", ")
    const rest = failures.length > MAX_NAMED_FAILURES ? ` and ${failures.length - MAX_NAMED_FAILURES} more` : ""
    reasons.push(`${failures.length} stylesheet request(s) failed: ${named}${rest}`)
  }

  /*
   * Signal 2 — a stylesheet the DOCUMENT DECLARED that is not in effect.
   *
   * 🛑 THE STRONGEST OF THE FOUR, AND THE ONE WHOSE ABSENCE LET THE FIRST
   * VERSION PASS ON A GENUINELY UNSTYLED PAGE. It is per-sheet, so one sheet
   * dying cannot be masked by another surviving; it needs no opinion about
   * which rules matter; and `<link>` + null `.sheet` is not ambiguous once the
   * load event has fired.
   */
  if (probe.deadLinks.length > 0) {
    const named = probe.deadLinks.slice(0, MAX_NAMED_FAILURES).join(", ")
    const rest =
      probe.deadLinks.length > MAX_NAMED_FAILURES ? ` and ${probe.deadLinks.length - MAX_NAMED_FAILURES} more` : ""
    reasons.push(
      `${probe.deadLinks.length} of ${probe.declaredLinks} declared <link rel="stylesheet"> ` +
        `never became a stylesheet: ${named}${rest}`,
    )
  }

  /*
   * Signal 3 — served, readable, and empty. A truncated body or an error page
   * returned with a CSS content-type parses to zero rules, and the network
   * layer sees a clean 200 throughout.
   */
  if (probe.emptySheets > 0) {
    reasons.push(
      `${probe.emptySheets} same-origin stylesheet(s) parsed to ZERO rules — served but empty or truncated`,
    )
  }

  /*
   * Signal 4 — the DOM contradicting itself: the markup is asking for `af-`
   * styling that no rule provides. This is the backstop for a sheet that was
   * served but empty, truncated, or replaced by an error body, where the
   * network layer sees a clean 200 and reports nothing.
   *
   * 🛑 AND IT IS GATED ON BEING ABLE TO ANSWER THE QUESTION AT ALL, WHICH IS THE
   * POINT OF THE TWO CONDITIONS BELOW.
   *
   *   `afElements === 0`      — the route genuinely uses no `af-` classes. Zero
   *                             `af-` rules is then the CORRECT state, not a
   *                             finding. Without this the guard would red every
   *                             route that happens not to use the design system.
   *
   *   `unreadableSheets > 0`  — at least one sheet is cross-origin and opaque.
   *                             `afRules === 0` then means "could not look",
   *                             which is not the same as "not there", and
   *                             reporting it as a finding is a negative asserted
   *                             without a control. This lane has already paid
   *                             for that distinction once: an absence measured
   *                             through an instrument that could not have seen
   *                             the thing was broadcast as a three-day-old
   *                             breakage, and was wrong.
   *
   * In both cases the network signal above still applies. This one abstains.
   */
  const domCanAnswer = probe.afElements > 0 && probe.unreadableSheets === 0
  if (domCanAnswer && probe.afRules === 0) {
    reasons.push(
      `the DOM carries ${probe.afElements} element(s) with \`af-\` classes but ZERO \`af-\` ` +
        `rules are in effect across ${probe.sheets} stylesheet(s) — the markup rendered without its CSS`,
    )
  }

  return { styled: reasons.length === 0, reasons }
}

/**
 * The message the gate fails with. Kept here so the wording is covered by the
 * unit test rather than drifting in the spec.
 *
 * ⚠ It has one job beyond naming the cause: tell the reader NOT to act on the
 * geometry. Whoever sees this is looking at a red mobile lane, and the obvious
 * next move — reading the numbers underneath and fixing the CSS — is the one
 * that wasted a day.
 */
export function unstyledFailureMessage(route: string, verdict: StylesheetVerdict): string {
  return (
    `${route} rendered WITHOUT its stylesheet, so no layout assertion below it means anything.\n` +
    verdict.reasons.map((r) => `  - ${r}`).join("\n") +
    `\n\nThis is an environment failure, not a product defect. The usual cause is the CI dev ` +
    `server restarting mid-run ("Server is approaching the used memory threshold"), which ` +
    `serves the document but resets its subresources. Do NOT "fix" any target size or ` +
    `overflow this run reports — an unstyled page reports text nodes as 20px-wide controls. ` +
    `Re-run the lane; if it reproduces, the dev server is the thing to look at.`
  )
}
