/**
 * [NEW] lib/ncaaf-roster/NcaafRosterConfigService.ts
 * Read/write NCAAF roster config. Dual-writes to League.settings + LeagueRosterConfig.
 */
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { resolveNcaafRosterTemplate, calculateNcaafRosterSize } from './NcaafRosterTemplates'

const PREFIX = 'ncaaf_roster_'

export interface LeagueNcaafRosterConfig {
  templateKey: string; templateLabel: string; slots: Record<string, number>
  isCustom: boolean; rosterSize: { starters: number; bench: number; total: number }
  lastUpdatedAt: string | null; lastUpdatedBy: string | null
}

export async function getLeagueNcaafRosterConfig(leagueId: string): Promise<LeagueNcaafRosterConfig> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true, leagueType: true } })
  if (!league || league.sport !== 'NCAAF') {
    const t = resolveNcaafRosterTemplate('redraft')
    return { templateKey: t.key, templateLabel: t.label, slots: t.slots, isCustom: false, rosterSize: calculateNcaafRosterSize(t.slots), lastUpdatedAt: null, lastUpdatedBy: null }
  }
  const s = (league.settings as Record<string, unknown>) ?? {}
  const raw = s[`${PREFIX}config`] as Record<string, unknown> | undefined
  if (!raw) {
    const t = resolveNcaafRosterTemplate(league.leagueType ?? 'redraft')
    return { templateKey: t.key, templateLabel: t.label, slots: t.slots, isCustom: false, rosterSize: calculateNcaafRosterSize(t.slots), lastUpdatedAt: null, lastUpdatedBy: null }
  }
  const slots = (raw.slots as Record<string, number>) ?? {}
  return { templateKey: (raw.templateKey as string) ?? 'redraft', templateLabel: (raw.templateLabel as string) ?? 'Custom', slots, isCustom: Boolean(raw.isCustom), rosterSize: calculateNcaafRosterSize(slots), lastUpdatedAt: (raw.lastUpdatedAt as string) ?? null, lastUpdatedBy: (raw.lastUpdatedBy as string) ?? null }
}

export async function saveLeagueNcaafRosterConfig(leagueId: string, config: { templateKey: string; slots: Record<string, number>; isCustom?: boolean; userId?: string }): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const cs = (league?.settings as Record<string, unknown>) ?? {}
  await prisma.league.update({ where: { id: leagueId }, data: { settings: toPrismaJsonInput({ ...cs, [`${PREFIX}config`]: { templateKey: config.templateKey, templateLabel: config.templateKey, slots: config.slots, isCustom: config.isCustom ?? false, lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: config.userId ?? null } }) } })
  try {
    const overrides = { customSlots: config.slots, customTemplateKey: config.templateKey, isCustom: config.isCustom ?? false, updatedAt: new Date().toISOString() }
    const existing = await prisma.leagueRosterConfig.findUnique({ where: { leagueId } })
    if (existing) { await prisma.leagueRosterConfig.update({ where: { leagueId }, data: { overrides: toPrismaJsonInput(overrides) } }) }
    else { await prisma.leagueRosterConfig.create({ data: { leagueId, templateId: `custom-NCAAF-${leagueId}`, overrides: toPrismaJsonInput(overrides) } }) }
  } catch { /* non-fatal */ }
}

export async function applyDefaultNcaafRosterOnCreate(leagueId: string, leagueType: string): Promise<void> {
  const t = resolveNcaafRosterTemplate(leagueType)
  await saveLeagueNcaafRosterConfig(leagueId, { templateKey: t.key, slots: t.slots })
}
