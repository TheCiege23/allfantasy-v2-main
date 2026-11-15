import 'server-only'

import type { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { settingsLockedResponse } from './settingsLockGuard'

/**
 * The two things every specialty format's own rules route owes the league (2026-11-15), like the generic settings
 * patch already does for scoring, rosters and playoffs:
 *
 *   1. the settings lock — `formatRulesLockedResponse` is a 423 when the commissioner locked "Format rules" for the
 *      season (lib/league/settingsLock.ts), so a locked format rule changes mid-year only after a league vote;
 *   2. the league log — `logFormatRulesChange` writes the `settings_patch` row the log words as "Changed the format
 *      settings" (lib/league-log/leagueLog.ts, section `conceptRules`), so a mid-season change is never invisible.
 *
 * 🛑 Until this, guillotine, pirate, Big Brother, devy, C2C and IDP rule edits skipped both: a commissioner could
 * change the pirate protection limit mid-season and nothing anywhere said so.
 *
 * Call the lock AFTER the route's own permission check and BEFORE anything is written; log only after the write
 * succeeded. Both fail open / best-effort, like the guards they sit beside: a database blip must not brick a
 * settings screen, and a failed log line must not fail a save that already landed.
 */
export type FormatName = 'guillotine' | 'pirate' | 'big_brother' | 'devy' | 'c2c' | 'idp' | 'zombie'

export function formatRulesLockedResponse(leagueId: string): Promise<NextResponse | null> {
  return settingsLockedResponse(leagueId, 'format')
}

export async function logFormatRulesChange(input: { leagueId: string; userId: string | null; format: FormatName; fields?: string[] }): Promise<void> {
  try {
    await prisma.leagueAuditLog.create({
      data: {
        leagueId: input.leagueId,
        userId: input.userId,
        actionType: 'settings_patch',
        entityType: 'league',
        entityId: input.leagueId,
        metadata: { section: 'conceptRules', format: input.format, ...(input.fields?.length ? { fields: input.fields.slice(0, 40) } : {}) },
      },
    })
  } catch (e) {
    console.warn('[format-rules] league log write failed', { leagueId: input.leagueId, format: input.format, error: e instanceof Error ? e.message : String(e) })
  }
}
