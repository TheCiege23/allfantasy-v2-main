import 'server-only'
import { Prisma } from '@prisma/client'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { sgRosterAtPeriod } from './rosterExpansion'
import type { SGConfig } from './types'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}

/** Shares the season transaction. No historical lineup assignments or player ownership are rewritten. */
export async function applySGRosterExpansion(tx: Prisma.TransactionClient, leagueId: string, config: SGConfig, period: number) {
  if (!config.rosterExpansion?.enabled) return null
  if (config.sport !== 'NFL') throw new Error('NFL roster expansion cannot be applied to another sport.')
  const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true, sport: true } })
  if (league.sport !== 'NFL') throw new Error('Roster expansion sport does not match the league.')
  const settings = record(league.settings), specialty = record(settings.survivorGuillotine)
  const previous = record(specialty.rosterExpansionState)
  if (Number(previous.period ?? 0) > period) throw new Error('Roster expansion cannot move an active league backward.')
  const inheritedBench = Number.isInteger(previous.openingBenchSlots) ? Number(previous.openingBenchSlots)
    : resolveRedraftRosterConfig('NFL', settings).benchSlots
  const layout = sgRosterAtPeriod(config.rosterExpansion, Math.max(1, period), inheritedBench)
  const resolved = resolveRedraftRosterConfig('NFL', settings)
  const slots = { ...layout.slots, BN: layout.bench, IR: resolved.irSlots, TAXI: resolved.taxiSlots }
  const total = layout.starters + layout.bench + resolved.irSlots + resolved.taxiSlots
  const stamp = { period, openingBenchSlots: config.rosterExpansion.openingBenchSlots ?? inheritedBench, slots }
  const layouts = record(specialty.rosterLayouts)
  const updated = { ...settings,
    roster: { ...record(settings.roster), config: { ...record(record(settings.roster).config),
      sections: [{ key: 'primary', label: 'Primary', slots }] } },
    rosterSettings: { ...record(settings.rosterSettings), starterSlots: layout.slots,
      benchSlots: layout.bench, irSlots: resolved.irSlots, taxiSlots: resolved.taxiSlots, totalRosterSlots: total },
    nfl_roster_config: { ...record(settings.nfl_roster_config), slots, isCustom: true,
      templateKey: 'survivor_all_stars', templateLabel: 'Survivor All-Stars' },
    survivorGuillotine: { ...specialty, rosterExpansionState: stamp,
      rosterLayouts: { ...layouts, [String(period)]: slots } },
    ...(period === 0 ? { draft_rounds: layout.starters + layout.bench } : {}) }
  await tx.league.update({ where: { id: leagueId }, data: { rosterSize: total,
    settings: updated as Prisma.InputJsonValue } })
  const existing = await tx.leagueRosterConfig.findUnique({ where: { leagueId }, select: { overrides: true } })
  const overrides = { ...record(existing?.overrides), customSlots: slots, customTemplateKey: 'survivor_all_stars', isCustom: true }
  await tx.leagueRosterConfig.upsert({ where: { leagueId },
    create: { leagueId, templateId: `custom-NFL-${leagueId}`, overrides: overrides as Prisma.InputJsonValue },
    update: { overrides: overrides as Prisma.InputJsonValue } })
  if (period === 0) await tx.draftSession.updateMany({ where: { leagueId, status: 'pre_draft' },
    data: { rounds: layout.starters + layout.bench } })
  return { ...layout, total }
}
