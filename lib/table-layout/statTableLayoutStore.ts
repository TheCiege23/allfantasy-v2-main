import 'server-only'

import { prisma } from '@/lib/prisma'
import { readLayouts, sanitizeDensity, sanitizeLayout, type StatTableLayouts, type TableDensity, type TableLayout } from './statTableLayout'

/**
 * The stat-table layouts on `user_profiles.core_preferences`, under two keys of their own:
 *
 *   statTableLayouts   { [tableId]: { order, hidden } }
 *   statTableDensity   'comfortable' | 'compact'
 *
 * Written with the same atomic jsonb merge as lib/league-rules-explainer/seenStore.ts: one statement,
 * only this key touched, so a concurrent write of another preference is never overwritten by a
 * read-modify-write here. A failed read answers the defaults; a table never refuses to draw over it.
 */

const LAYOUTS_KEY = 'statTableLayouts'
const DENSITY_KEY = 'statTableDensity'

export async function getStatTableLayouts(userId: string): Promise<StatTableLayouts> {
  try {
    const rows = await prisma.$queryRaw<Array<{ tables: unknown; density: unknown }>>`
      SELECT core_preferences->${LAYOUTS_KEY}::text AS tables, core_preferences->>${DENSITY_KEY}::text AS density
      FROM user_profiles WHERE "userId" = ${userId}
    `
    return readLayouts(rows[0]?.tables ?? null, rows[0]?.density ?? null)
  } catch {
    return readLayouts(null, null)
  }
}

/** Save one table's layout; `null` resets it to the table's default. */
export async function setStatTableLayout(userId: string, tableId: string, layout: TableLayout | null): Promise<void> {
  const clean = layout ? sanitizeLayout(layout) : null
  if (clean == null || (clean.order.length === 0 && clean.hidden.length === 0)) {
    await prisma.$executeRaw`
      UPDATE user_profiles SET
        core_preferences = core_preferences || jsonb_build_object(
          ${LAYOUTS_KEY}::text,
          (CASE WHEN jsonb_typeof(core_preferences->${LAYOUTS_KEY}::text) = 'object'
                THEN core_preferences->${LAYOUTS_KEY}::text ELSE '{}'::jsonb END) - ${tableId}::text
        ),
        "updatedAt" = NOW()
      WHERE "userId" = ${userId} AND core_preferences IS NOT NULL
    `
    return
  }
  const json = JSON.stringify(clean)
  await prisma.$executeRaw`
    INSERT INTO user_profiles ("userId", "updatedAt", core_preferences)
    VALUES (${userId}, NOW(), jsonb_build_object(${LAYOUTS_KEY}::text, jsonb_build_object(${tableId}::text, ${json}::jsonb)))
    ON CONFLICT ("userId") DO UPDATE SET
      core_preferences = COALESCE(user_profiles.core_preferences, '{}'::jsonb) ||
        jsonb_build_object(
          ${LAYOUTS_KEY}::text,
          (CASE WHEN jsonb_typeof(user_profiles.core_preferences->${LAYOUTS_KEY}::text) = 'object'
                THEN user_profiles.core_preferences->${LAYOUTS_KEY}::text ELSE '{}'::jsonb END)
            || jsonb_build_object(${tableId}::text, ${json}::jsonb)
        ),
      "updatedAt" = NOW()
  `
}

export async function setStatTableDensity(userId: string, density: TableDensity): Promise<void> {
  const value = sanitizeDensity(density)
  await prisma.$executeRaw`
    INSERT INTO user_profiles ("userId", "updatedAt", core_preferences)
    VALUES (${userId}, NOW(), jsonb_build_object(${DENSITY_KEY}::text, ${value}::text))
    ON CONFLICT ("userId") DO UPDATE SET
      core_preferences = COALESCE(user_profiles.core_preferences, '{}'::jsonb) || jsonb_build_object(${DENSITY_KEY}::text, ${value}::text),
      "updatedAt" = NOW()
  `
}
