import 'server-only'

import { prisma } from '@/lib/prisma'
import { readSurvivorFinaleSettings } from './survivorFinaleSettings'
import { isImmunitySealed } from './survivorSealedImmunity'

/**
 * Server read of the sealed-immunity hook (survivorSealedImmunity.ts) for one week: the setting and
 * that week's latest council. Never throws; a failed read means "not sealed" so nothing is hidden by
 * accident from a league that never turned the option on.
 */
export async function loadImmunitySealed(leagueId: string, week: number | null | undefined): Promise<boolean> {
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!readSurvivorFinaleSettings(league?.settings).sealedImmunity) return false
    if (week == null || !Number.isFinite(week)) return true
    const council = await prisma.survivorTribalCouncil.findFirst({ where: { leagueId, week }, orderBy: { councilNumber: 'desc' }, select: { status: true, closedAt: true, isRevealed: true } })
    return isImmunitySealed(true, council)
  } catch {
    return false
  }
}
