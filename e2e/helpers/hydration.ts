import { expect, type Locator } from '@playwright/test'

/**
 * Wait until React has actually attached its handlers to an element, not merely
 * until the element is on screen.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * `expect(cta).toBeVisible()` passes on the SERVER-RENDERED markup. The button
 * is in the DOM, it is visible, it is enabled, and Playwright's actionability
 * checks are all satisfied — but React has not hydrated yet, so it carries no
 * onClick. A click in that window is a no-op: nothing throws, nothing navigates,
 * and the test fails much later on a `waitForURL` timeout that points at the
 * wrong line.
 *
 * ⚠ MEASURED, NOT ASSUMED. Probing /pricing on a cold dev server with a
 * `__reactProps$` read at each step:
 *
 *     domContentLoaded    32,573ms   (cold compile)
 *     CTA visible         32,641ms   <- toBeVisible() returns here
 *       onClick attached:   false
 *     onClick attached    32,706ms
 *     gap                     65ms
 *
 * 65ms on a developer machine with one test running. CI compiles cold on every
 * shard, runs several suites, and is slower — and the failure this produces
 * (element visible, click does nothing, later timeout) matches a large share of
 * the "element(s) not found" and click-timeout failures across the core shards.
 *
 * Reproduced deliberately: the same three monetization tests pass against a WARM
 * server and fail against a COLD one with no code change between runs.
 *
 * ── WHY IT READS A REACT INTERNAL ────────────────────────────────────────────
 *
 * `__reactProps$*` is the only signal that answers the actual question — "is
 * this specific element wired up yet". The alternatives were considered and are
 * worse: a fixed sleep is either flaky or slow, `networkidle` says nothing about
 * hydration, and stamping a `data-hydrated` marker on the app would put a
 * test-only concern into production HTML.
 *
 * The brittleness is contained on purpose: if React ever stops exposing that
 * key, `probe()` reports `reactUnknown` and this function RETURNS rather than
 * hanging or failing. The suite then behaves exactly as it does today instead of
 * breaking everywhere at once.
 */

type Probe = { attached: boolean; reactUnknown: boolean }

async function probe(locator: Locator): Promise<Probe> {
  return locator.evaluate((el) => {
    const keys = Object.keys(el)
    const propsKey = keys.find((k) => k.startsWith('__reactProps$'))
    const fiberKey = keys.find((k) => k.startsWith('__reactFiber$'))
    // Neither key present at all: either not hydrated yet, or a React version
    // that no longer exposes them. Those are told apart by the caller's timeout.
    if (!propsKey && !fiberKey) return { attached: false, reactUnknown: true }
    const props = propsKey
      ? (el as unknown as Record<string, Record<string, unknown> | undefined>)[propsKey]
      : undefined
    const hasHandler =
      typeof props?.onClick === 'function' ||
      typeof props?.onChange === 'function' ||
      typeof props?.onSubmit === 'function'
    /*
     * ⚠ THE FIBER IS THE DEFINITION OF HYDRATED; A HANDLER IS ONLY THE COMMON
     * CASE. Requiring a handler looked stricter and was wrong: plenty of
     * legitimate targets carry none — a plain anchor, a label, a element whose
     * behaviour lives on an ancestor — and on those this would have burned the
     * FULL timeout on every call before continuing anyway. Across a suite with
     * 96 spec files that is minutes of pure waiting added to shards that already
     * run over an hour, which would have made the flakiness fix a performance
     * regression.
     *
     * React 18 attaches `__reactFiber$` and `__reactProps$` to a node together,
     * so accepting the fiber does not weaken the timing this was built for — the
     * measured 65ms gap on /pricing is a gap in BOTH keys, not just props.
     */
    return { attached: Boolean(fiberKey) || hasHandler, reactUnknown: false }
  })
}

/**
 * Resolves once the element has React handlers attached.
 *
 * Never throws on timeout. A test that proceeds un-hydrated fails the same way
 * it does today; this only ever makes that less likely, which is the point — a
 * helper added to fix flakiness must not become a new source of failure.
 */
export async function waitForHydrated(locator: Locator, timeout = 20_000): Promise<void> {
  const deadline = Date.now() + timeout
  let sawReact = false

  while (Date.now() < deadline) {
    let result: Probe
    try {
      result = await probe(locator)
    } catch {
      // Element detached mid-probe (a re-render). Retry until the deadline.
      await locator.page().waitForTimeout(50)
      continue
    }
    if (result.attached) return
    if (!result.reactUnknown) sawReact = true
    await locator.page().waitForTimeout(50)
  }

  /*
   * Fell through. Two different situations, and neither is worth failing on:
   * React internals are not visible at all (sawReact === false), so we cannot
   * measure hydration on this build and should not block; or they are visible
   * and this element genuinely never attached a handler, which the caller's own
   * assertion will report far more usefully than a timeout in here would.
   */
  void sawReact
}

/**
 * `click()` that waits for hydration first.
 *
 * Drop-in for `locator.click()` anywhere a click drives client-side behaviour —
 * navigation, a fetch, a state change. Not needed for plain `<a href>` links,
 * which work before hydration.
 */
export async function clickHydrated(locator: Locator, timeout = 20_000): Promise<void> {
  await expect(locator).toBeVisible({ timeout })
  await waitForHydrated(locator, timeout)
  await locator.click()
}
