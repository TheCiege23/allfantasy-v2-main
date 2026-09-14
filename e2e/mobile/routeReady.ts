import { expect, type Page } from "@playwright/test"

/**
 * What "this route has rendered its content" means, for routes whose content arrives
 * after `load`.
 *
 * 🛑 WHY THIS EXISTS. The whole server response for /login is ClientOnlyAuthPage's boot
 * shell — a wordmark and "Loading…". The sign-in form mounts only after hydration flips
 * `mounted` in a useEffect, and that can land AFTER the `load` event the phone gate waits
 * for. When it did, the geometry probe measured the shell: zero inputs, so `smallFields`
 * came back `[]` — a pass that had measured nothing.
 *
 * Measured 2026-09-14: PR #861's mobile-smoke run 34862601670 happened to catch the form
 * mounted and reported both sign-in inputs at 14px. The re-run of that same job passed, as
 * did #858's and #862's runs — while the stylesheet made those inputs 14px on every one of
 * them (no rule anywhere raised `.af-au-field input` on a phone). A green /login row was
 * mostly a row that had not looked.
 *
 * ⚠ HARD, NOT SOFT, AND NOT SWALLOWED. If the form never renders, every number the gate
 * then reads describes the loading shell, so the test must stop there rather than report
 * those numbers as the route's.
 */
export const ROUTE_READY_SELECTOR: Readonly<Record<string, string>> = {
  "/login": 'input[name="login"]',
}

export async function waitForRouteReady(page: Page, route: string, timeout = 30_000): Promise<void> {
  const selector = ROUTE_READY_SELECTOR[route]
  if (!selector) return
  await expect(
    page.locator(selector).first(),
    `${route} never rendered ${selector}; the phone checks would be measuring its loading shell`,
  ).toBeVisible({ timeout })
}
