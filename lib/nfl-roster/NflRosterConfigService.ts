/**
 * [UPDATED] lib/nfl-roster/NflRosterConfigService.ts
 * Read/write NFL roster configuration.
 * Writes to BOTH League.settings JSON AND LeagueRosterConfig.overrides
 * so all downstream systems (draft, waivers, lineup validation, best ball) pick up changes.
 */
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { resolveNflRosterTemplate, calculateRosterSize } from './NflRosterTemplates'

const PREFIX = 'nfl_roster_'

export interface LeagueNflRosterConfig {
  templateKey: string
  templateLabel: string
  slots: Record<string, number>
  isCustom: boolean
  rosterSize: { starters: number; bench: number; total: number }
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
}

export async function getLeagueNflRosterConfig(leagueId: string): Promise<LeagueNflRosterConfig> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true, leagueType: true } })
  if (!league || league.sport !== 'NFL') {
    const tmpl = resolveNflRosterTemplate('redraft')
    return { templateKey: tmpl.key, templateLabel: tmpl.label, slots: tmpl.slots, isCustom: false, rosterSize: calculateRosterSize(tmpl.slots), lastUpdatedAt: null, lastUpdatedBy: null }
  }
  const s = (league.settings as Record<string, unknown>) ?? {}
  const raw = s[`${PREFIX}config`] as Record<string, unknown> | undefined
  if (!raw) {
    const tmpl = resolveNflRosterTemplate(league.leagueType ?? 'redraft')
    return { templateKey: tmpl.key, templateLabel: tmpl.label, slots: tmpl.slots, isCustom: false, rosterSize: calculateRosterSize(tmpl.slots), lastUpdatedAt: null, lastUpdatedBy: null }
  }
  const slots = (raw.slots as Record<string, number>) ?? {}
  return {
    templateKey: (raw.templateKey as string) ?? 'redraft',
    templateLabel: (raw.templateLabel as string) ?? 'Custom',
    slots, isCustom: Boolean(raw.isCustom),
    rosterSize: calculateRosterSize(slots),
    lastUpdatedAt: (raw.lastUpdatedAt as string) ?? null,
    lastUpdatedBy: (raw.lastUpdatedBy as string) ?? null,
  }
}

export async function saveLeagueNflRosterConfig(leagueId: string, config: { templateKey: string; slots: Record<string, number>; isCustom?: boolean; userId?: string }): Promise<void> {
  // 1. Write to League.settings JSON (primary source for our roster settings UI)
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const cs = (league?.settings as Record<string, unknown>) ?? {}
  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: {
        ...cs,
        [`${PREFIX}config`]: {
          templateKey: config.templateKey,
          templateLabel: config.templateKey,
          slots: config.slots,
          isCustom: config.isCustom ?? false,
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: config.userId ?? null,
        },
      },
    },
  })

  // 2. Also update LeagueRosterConfig.overrides so downstream systems
  //    (draft validation, best ball optimizer, lineup validation) pick up the change.
  //    The getRosterTemplate() function in RosterTemplateService now reads from League.settings,
  //    but LeagueRosterConfig.overrides is a backup path for any legacy consumers.
  try {
    const existing = await prisma.leagueRosterConfig.findUnique({ where: { leagueId } })
    const overrides = {
      customSlots: config.slots,
      customTemplateKey: config.templateKey,
      isCustom: config.isCustom ?? false,
      updatedAt: new Date().toISOString(),
    }
    if (existing) {
      await prisma.leagueRosterConfig.update({
        where: { leagueId },
        data: { overrides: toPrismaJsonInput(overrides) },
      })
    } else {
      await prisma.leagueRosterConfig.create({
        data: {
          leagueId,
          templateId: `custom-NFL-${leagueId}`,
          overrides: toPrismaJsonInput(overrides),
        },
      })
    }
  } catch {
    // Non-fatal — League.settings is the primary source; LeagueRosterConfig is backup
  }

  // 3. Update league-level roster size fields for quick access
  try {
    const size = calculateRosterSize(config.slots)
    await prisma.league.update({
      where: { id: leagueId },
      data: { leagueSize: (league?.settings as Record<string, unknown>)?.league_size as number ?? undefined },
    })
  } catch {
    // Non-fatal
  }
}

export async function applyDefaultNflRosterOnCreate(leagueId: string, leagueType: string): Promise<void> {
  const tmpl = resolveNflRosterTemplate(leagueType)
  await saveLeagueNflRosterConfig(leagueId, { templateKey: tmpl.key, slots: tmpl.slots })
}
