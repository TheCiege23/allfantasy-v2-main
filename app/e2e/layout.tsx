import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

/**
 * Every page under /e2e is a test harness for the Playwright suite, which runs against `next dev`
 * (playwright.config.ts and playwright.native-testdb.config.ts). None of them belongs in production.
 *
 * 🛑 THE GUARD LIVES HERE, ONCE, SO A NEW HARNESS CANNOT FORGET IT (2026-09-29). Each page used to
 * carry its own `if (process.env.NODE_ENV === 'production') notFound()`, and 12 of them did not:
 * /e2e/roster, /e2e/draft-room, /e2e/subscription-entitlement and nine more answered 200 on
 * allfantasy.ai to anyone with the URL — mock data and half-built screens where an App Store
 * reviewer or a user could land on them. A layout wraps every page beneath it, so this covers
 * those 12 and any harness added later. The per-page guards stay; they are now redundant, not wrong.
 */
export default function E2eHarnessLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return children
}
