import { prisma } from '../prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import {
  getRosterEngineRegistry,
} from './RosterEngineRegistry'
import {
  checkCommissionerPermission,
  detectReadOnlyRosterView,
} from './RosterPermissionsService'
import { mapImportedRosterToAF } from './RosterImportMapper'
import { validateRosterConfig } from './RosterValidationEngine'
import type {
  RosterAuditEntry,
  RosterDiffResult,
  RosterSlotDefinition,
  RosterTemplateDefinition,
  SupportedRosterSport,
  UnifiedRosterConfig,
} from './RosterEngineTypes'

function buildSectionsFromSlots(slots: Record<string, number>) {
  const hasC2C = Object.keys(slots).some((k) => k.startsWith('C2C_'))
  if (!hasC2C) {
    return [{ key: 'primary', label: 'Primary', slots }]
  }

  const primary: Record<string, number> = {}
  const c2c: Record<string, number> = {}

  for (const [key, value] of Object.entries(slots)) {
    if (key.startsWith('C2C_')) c2c[key] = value
    else primary[key] = value
  }

  return [
    { key: 'primary', label: 'Primary', slots: primary },
    { key: 'c2c', label: 'C2C / Dual Track', slots: c2c },
  ]
}

function compareRosterToTemplate(
  slots: Record<string, number>,
  template: RosterTemplateDefinition,
): { matchesTemplate: boolean; diff: RosterDiffResult } {
  const keys = new Set([...Object.keys(slots), ...Object.keys(template.slots)])
  const changedKeys: string[] = []

  for (const key of keys) {
    const a = Number(slots[key] ?? 0)
    const b = Number(template.slots[key] ?? 0)
    if (a !== b) changedKeys.push(key)
  }

  return {
    matchesTemplate: changedKeys.length === 0,
    diff: {
      changedKeys,
      changedCount: changedKeys.length,
    },
  }
}

export async function resolveDefaultRosterTemplate(
  sport: SupportedRosterSport,
  leagueType: string,
): Promise<RosterTemplateDefinition> {
  return getRosterEngineRegistry().getService(sport).resolveDefaultTemplate(leagueType)
}

export async function getLeagueRosterConfig(
  leagueId: string,
): Promise<UnifiedRosterConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, leagueType: true, settings: true },
  })
  if (!league) throw new Error('League not found')

  const sport = league.sport as SupportedRosterSport
  const leagueType = league.leagueType ?? 'redraft'
  const service = getRosterEngineRegistry().getService(sport)
  const config = await service.getConfig(leagueId)
  const template = service.resolveDefaultTemplate(leagueType)
  const validation = validateRosterConfig(sport, leagueType, config.slots, service.getSlots())
  const compare = compareRosterToTemplate(config.slots, template)

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const meta = (settings.roster as Record<string, unknown>) ?? {}

  return {
    sport,
    leagueType,
    rosterTemplateKey: config.templateKey,
    rosterSource: (meta.source as UnifiedRosterConfig['rosterSource']) ?? (config.isCustom ? 'CUSTOM' : 'AF_DEFAULT'),
    rosterConfigVersion: Number(meta.version ?? 1),
    rosterLastUpdatedAt: config.lastUpdatedAt,
    rosterLastUpdatedBy: config.lastUpdatedBy,
    rosterIsCustom: config.isCustom,
    rosterMatchesTemplate: compare.matchesTemplate,
    rosterWarnings: validation.warnings,
    rosterAuditLog: Array.isArray(meta.auditLog) ? (meta.auditLog as RosterAuditEntry[]) : [],
    rosterConfig: {
      sections: buildSectionsFromSlots(config.slots),
    },
  }
}

export async function updateLeagueRosterConfig(
  leagueId: string,
  config: { templateKey: string; slots: Record<string, number> },
  userId: string,
  options?: { auditAction?: 'updated' | 'reset' | 'import' },
): Promise<UnifiedRosterConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, leagueType: true, settings: true },
  })
  if (!league) throw new Error('League not found')

  const permission = await checkCommissionerPermission(userId, leagueId)
  if (!permission.isCommissioner) throw new Error(permission.reason ?? 'Commissioner only')

  const sport = league.sport as SupportedRosterSport
  const leagueType = league.leagueType ?? 'redraft'
  const service = getRosterEngineRegistry().getService(sport)
  const validation = validateRosterConfig(sport, leagueType, config.slots, service.getSlots())
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '))
  }

  await service.saveConfig(leagueId, {
    templateKey: config.templateKey,
    slots: config.slots,
    isCustom: config.templateKey === 'custom',
    userId,
  })

  const latest = await service.getConfig(leagueId)
  const template = service.resolveDefaultTemplate(leagueType)
  const compare = compareRosterToTemplate(latest.slots, template)

  const currentSettings = (league.settings as Record<string, unknown>) ?? {}
  const previousMeta = (currentSettings.roster as Record<string, unknown>) ?? {}
  const nextVersion = Number(previousMeta.version ?? 0) + 1
  const previousAudit = Array.isArray(previousMeta.auditLog) ? (previousMeta.auditLog as RosterAuditEntry[]) : []
  const auditEntry: RosterAuditEntry = {
    timestamp: new Date().toISOString(),
    userId,
    action: options?.auditAction ?? 'updated',
    templateKey: latest.templateKey,
    changedKeys: compare.diff.changedKeys,
  }
  const nextAudit = [...previousAudit, auditEntry].slice(-50)

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: toPrismaJsonInput({
        ...currentSettings,
        roster: {
          sport,
          leagueType,
          templateKey: latest.templateKey,
          source: config.templateKey === 'custom' ? 'CUSTOM' : 'AF_DEFAULT',
          version: nextVersion,
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
          isCustom: config.templateKey === 'custom',
          matchesTemplate: compare.matchesTemplate,
          warnings: validation.warnings,
          auditLog: nextAudit,
          config: {
            sections: buildSectionsFromSlots(latest.slots),
          },
        },
      }),
    },
  })

  return getLeagueRosterConfig(leagueId)
}

export async function createDefaultLeagueRosterConfig(
  leagueId: string,
  sport: SupportedRosterSport,
  leagueType: string,
): Promise<void> {
  const service = getRosterEngineRegistry().getService(sport)
  await service.applyDefaultOnCreate(leagueId, leagueType)

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const settings = (league?.settings as Record<string, unknown>) ?? {}
  const config = await service.getConfig(leagueId)
  const template = service.resolveDefaultTemplate(leagueType)
  const compare = compareRosterToTemplate(config.slots, template)
  const auditEntry: RosterAuditEntry = {
    timestamp: new Date().toISOString(),
    userId: null,
    action: 'created',
    templateKey: config.templateKey,
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: toPrismaJsonInput({
        ...settings,
        roster: {
          sport,
          leagueType,
          templateKey: config.templateKey,
          source: 'AF_DEFAULT',
          version: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: null,
          isCustom: false,
          matchesTemplate: compare.matchesTemplate,
          warnings: [],
          auditLog: [auditEntry],
          config: {
            sections: buildSectionsFromSlots(config.slots),
          },
        },
      }),
    },
  })
}

export async function getAvailableRosterSlots(
  sport: SupportedRosterSport,
  _leagueType: string,
): Promise<RosterSlotDefinition[]> {
  return getRosterEngineRegistry().getService(sport).getSlots()
}

export async function compareLeagueRosterToTemplate(
  leagueId: string,
): Promise<{ matchesTemplate: boolean; diff: RosterDiffResult; templateKey: string }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, leagueType: true } })
  if (!league) throw new Error('League not found')

  const sport = league.sport as SupportedRosterSport
  const service = getRosterEngineRegistry().getService(sport)
  const config = await service.getConfig(leagueId)
  const template = service.resolveDefaultTemplate(league.leagueType ?? 'redraft')
  const compare = compareRosterToTemplate(config.slots, template)

  return { ...compare, templateKey: template.key }
}

export async function mapImportedRosterToLeagueConfig(
  leagueId: string,
  sourcePlatform: string,
  importedConfig: Record<string, number>,
): Promise<UnifiedRosterConfig> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } })
  if (!league) throw new Error('League not found')

  const sport = league.sport as SupportedRosterSport
  const mapped = mapImportedRosterToAF({ sourcePlatform, sport, importedConfig })

  return updateLeagueRosterConfig(
    leagueId,
    { templateKey: 'custom', slots: mapped.mappedSlots },
    'import-mapper',
    { auditAction: 'import' },
  )
}

export async function resetLeagueRosterToDefault(
  leagueId: string,
  userId: string,
): Promise<UnifiedRosterConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, leagueType: true },
  })
  if (!league) throw new Error('League not found')

  const sport = league.sport as SupportedRosterSport
  const leagueType = league.leagueType ?? 'redraft'
  const template = await resolveDefaultRosterTemplate(sport, leagueType)

  return updateLeagueRosterConfig(
    leagueId,
    { templateKey: template.key, slots: template.slots },
    userId,
    { auditAction: 'reset' },
  )
}

export async function previewImportedRosterForLeague(
  leagueId: string,
  sourcePlatform: string,
  importedConfig: Record<string, number>,
): Promise<{
  mappedSlots: Record<string, number>
  unmappedSlots: string[]
  validation: ReturnType<typeof validateRosterConfig>
}> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, leagueType: true },
  })
  if (!league) throw new Error('League not found')

  const sport = league.sport as SupportedRosterSport
  const leagueType = league.leagueType ?? 'redraft'
  const service = getRosterEngineRegistry().getService(sport)
  const mapped = mapImportedRosterToAF({ sourcePlatform, sport, importedConfig })
  const validation = validateRosterConfig(sport, leagueType, mapped.mappedSlots, service.getSlots())

  return {
    mappedSlots: mapped.mappedSlots,
    unmappedSlots: mapped.unmappedSlots,
    validation,
  }
}

export {
  checkCommissionerPermission,
  detectReadOnlyRosterView,
  mapImportedRosterToAF,
  validateRosterConfig,
}
