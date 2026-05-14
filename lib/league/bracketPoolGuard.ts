/**
 * Bracket pool guard — determines whether a leagueId belongs to any bracket
 * pool table so that /league/[id] can redirect to /brackets/leagues/[id].
 *
 * Covers:
 *   - BracketLeague (UUID primary key — legacy NCAA / NCAAB pools)
 *   - PlayoffBracketChallenge (CUID primary key — NBA / NHL playoff pools)
 *   - WorldCupBracketChallenge (CUID primary key — FIFA World Cup pools)
 *
 * This module is import-safe for both server and test environments. Prisma
 * access is always behind try/catch so missing-table errors in environments
 * that haven't run all migrations are silently suppressed.
 */

import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Error classification helpers (mirroring app/brackets/leagues/[leagueId]/page.tsx)
// ---------------------------------------------------------------------------

/**
 * True when the Prisma error is caused by a missing table or an unsupported
 * model field — expected in preview/test environments that haven't run bracket
 * migrations yet.  These errors are silently suppressed by the guard so the
 * caller can continue with a "not found" fallback.
 */
export function isBracketPoolTableMissingError(err: unknown): boolean {
  if (!err) return false
  const e = err as Record<string, unknown>
  const s = String(err)
  return (
    e?.code === 'P2021' ||
    e?.code === 'P2025' ||
    (typeof e?.meta === 'object' &&
      e.meta !== null &&
      String((e.meta as Record<string, unknown>).cause ?? '').includes('does not exist')) ||
    s.includes('does not exist in the current database') ||
    s.includes('PrismaClientValidationError') ||
    s.includes('Unknown field') ||
    s.includes('playoffBracketChallenge') ||
    s.includes('bracketLeague') ||
    s.includes('worldCupBracketChallenge')
  )
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

/**
 * Returns `/brackets/leagues/${leagueId}` when the ID belongs to any bracket
 * pool table, `null` otherwise.
 *
 * The caller is responsible for calling `redirect(url)` with the returned
 * value — keeping `redirect()` out of the helper avoids the NEXT_REDIRECT
 * throw being swallowed by this function's own error handling.
 *
 * Silences missing-table errors; re-throws unexpected Prisma errors so they
 * bubble up to the page's outer catch for logging.
 */
export async function resolveBracketPoolRedirectUrl(leagueId: string): Promise<string | null> {
  // 1. BracketLeague (UUID-keyed — legacy pools created via /brackets/leagues/new)
  try {
    const row = await (prisma as any).bracketLeague.findUnique({
      where: { id: leagueId },
      select: { id: true },
    })
    if (row?.id) return `/brackets/leagues/${leagueId}`
  } catch (err) {
    if (!isBracketPoolTableMissingError(err)) throw err
    // Missing table in this environment — continue checking other tables
  }

  // 2. PlayoffBracketChallenge (CUID-keyed — modern NBA / NHL playoff pools)
  try {
    const row = await (prisma as any).playoffBracketChallenge.findUnique({
      where: { id: leagueId },
      select: { id: true },
    })
    if (row?.id) return `/brackets/leagues/${leagueId}`
  } catch (err) {
    if (!isBracketPoolTableMissingError(err)) throw err
  }

  // 3. WorldCupBracketChallenge (CUID-keyed — FIFA World Cup pools)
  try {
    const row = await (prisma as any).worldCupBracketChallenge.findUnique({
      where: { id: leagueId },
      select: { id: true },
    })
    if (row?.id) return `/brackets/leagues/${leagueId}`
  } catch (err) {
    if (!isBracketPoolTableMissingError(err)) throw err
  }

  return null
}
