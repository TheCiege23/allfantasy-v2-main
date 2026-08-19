/**
 * [NEW] lib/ncaab-roster/NcaabRosterConfigService.ts
 * Read/write NCAAB roster config. Dual-writes to League.settings + LeagueRosterConfig.
 */
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { resolveNcaabRosterTemplate, calculateNcaabRosterSize } from './NcaabRosterTemplates'

const PREFIX = 'ncaab_roster_'

export interface LeagueNcaabRosterConfig {
  templateKey: string; templateLabel: string; slots: Record<string, number>
  isCustom: boolean; rosterSize: { starters: number; bench: number; total: number }
  lastUpdatedAt: string | null; lastUpdatedBy: string | null
}

export async function getLeagueNcaabRosterConfig(leagueId: string): Promise<LeagueNcaabRosterConfig> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true, leagueType: true } })
  if (!league || league.sport !== 'NCAAB') {
    const t = resolveNcaabRosterTemplate('redraft')
    return { templateKey: t.key, templateLabel: t.label, slots: t.slots, isCustom: false, rosterSize: calculateNcaabRosterSize(t.slots), lastUpdatedAt: null, lastUpdatedBy: null }
  }
  const s = (league.settings as Record<string, unknown>) ?? {}
  const raw = s[`${PREFIX}config`] as Record<string, unknown> | undefined
  if (!raw) {
    const t = resolveNcaabRosterTemplate(league.leagueType ?? 'redraft')
    return { templateKey: t.key, templateLabel: t.label, slots: t.slots, isCustom: false, rosterSize: calculateNcaabRosterSize(t.slots), lastUpdatedAt: null, lastUpdatedBy: null }
  }
  const slots = (raw.slots as Record<string, number>) ?? {}
  return { templateKey: (raw.templateKey as string) ?? 'redraft', templateLabel: (raw.templateLabel as string) ?? 'Custom', slots, isCustom: Boolean(raw.isCustom), rosterSize: calculateNcaabRosterSize(slots), lastUpdatedAt: (raw.lastUpdatedAt as string) ?? null, lastUpdatedBy: (raw.lastUpdatedBy as string) ?? null }
}

export async function saveLeagueNcaabRosterConfig(leagueId: string, config: { templateKey: string; slots: Record<string, number>; isCustom?: boolean; userId?: string }): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const cs = (league?.settings as Record<string, unknown>) ?? {}
  await prisma.league.update({ where: { id: leagueId }, data: { settings: toPrismaJsonInput({ ...cs, [`${PREFIX}config`]: { templateKey: config.templateKey, templateLabel: config.templateKey, slots: config.slots, isCustom: config.isCustom ?? false, lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: config.userId ?? null } }) } })
  try {
    const overrides = { customSlots: config.slots, customTemplateKey: config.templateKey, isCustom: config.isCustom ?? false, updatedAt: new Date().toISOString() }
    const existing = await prisma.leagueRosterConfig.findUnique({ where: { leagueId } })
    if (existing) { await prisma.leagueRosterConfig.update({ where: { leagueId }, data: { overrides: toPrismaJsonInput(overrides) } }) }
    else { await prisma.leagueRosterConfig.create({ data: { leagueId, templateId: `custom-NCAAB-${leagueId}`, overrides: toPrismaJsonInput(overrides) } }) }
  } catch { /* non-fatal */ }
}

export async function applyDefaultNcaabRosterOnCreate(leagueId: string, leagueType: string): Promise<void> {
  const t = resolveNcaabRosterTemplate(leagueType)
  await saveLeagueNcaabRosterConfig(leagueId, { templateKey: t.key, slots: t.slots })
}
