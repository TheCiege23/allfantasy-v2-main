import type { Locator } from '@playwright/test'
import { clickHydrated } from './hydration'

/**
 * The pool's secondary filter rows (Watchlist, Hide drafted, Rookies, Vets, Clear filters) sit
 * behind the Filters button at every width since 2026-11-19; before, desktop always showed them.
 * Open it if it is closed, then act.
 */
export async function openPoolFilters(scope: Locator): Promise<void> {
  const toggle = scope.getByTestId('draft-mobile-filters-toggle').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await clickHydrated(toggle)
}

export async function clearPoolFilters(scope: Locator): Promise<void> {
  await openPoolFilters(scope)
  await clickHydrated(scope.getByTestId('draft-clear-filters'))
}
