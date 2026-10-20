import 'server-only'

import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { ADVANCED_KEY, isDefault, normalizeAdvanced, readAdvanced, type GuillotineAdvanced, type NormalizeError } from './chopSchedule'

/**
 * Save the guillotine chop schedule and immunity (rules in ./chopSchedule). AF Commissioner
 * (`commissioner_automation`) to change them — spec §4.5 lists them in the Commissioner column.
 * Resetting to the plain one-chop-a-week season is always allowed, so a lapsed plan never traps a
 * league on rules it can no longer edit. Written under the league row lock: League.settings is shared
 * by every settings writer.
 */

export type SaveAdvancedError = NormalizeError | 'not_entitled' | 'not_found'

export async function readGuillotineAdvanced(leagueId: string): Promise<GuillotineAdvanced> {
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  return readAdvanced(row?.settings)
}

export async function saveGuillotineAdvanced(
  leagueId: string,
  userId: string,
  raw: unknown,
): Promise<{ ok: true; value: GuillotineAdvanced } | { ok: false; error: SaveAdvancedError }> {
  const n = normalizeAdvanced(raw)
  if (!n.ok) return n
  if (!isDefault(n.value)) {
    const access = await new FeatureGateService().evaluateUserFeatureAccess(userId, 'commissioner_automation').catch(() => null)
    if (!access?.allowed) return { ok: false, error: 'not_entitled' }
  }
  const written = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!row) return false
    const next = { ...((row.settings as Record<string, unknown> | null) ?? {}) }
    if (isDefault(n.value)) delete next[ADVANCED_KEY]
    else next[ADVANCED_KEY] = n.value
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as object } })
    return true
  })
  return written ? { ok: true, value: n.value } : { ok: false, error: 'not_found' }
}
