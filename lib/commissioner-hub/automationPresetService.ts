import 'server-only'

/**
 * Apply an automation preset (./automationPreset.ts): the plan is recomputed from the league as it is
 * now, and only its listed changes are written — the League.settings keys under the league row lock in
 * one transaction, then the live rookie order and the anti-tanking monitor through their own stores.
 * An automation the plan skipped for want of AF Commissioner is never written. Logged as one action.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { logAction } from '@/server/services/auditService'
import { FILL_EMPTY_STARTERS_KEY } from '@/lib/lineup-automation/fillEmptyStarters'
import { ELIMINATED_LINEUP_RULE_KEY } from '@/lib/eliminated-lineups/eliminatedLineups'
import { IR_AUTO_MOVE_KEY } from '@/lib/ir-activation/irAutoMove'
import { ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY } from '@/lib/dynasty-core/rookieDraftCalendar'
import { AUTO_HANDOVER_KEY } from '@/lib/inactive-manager/autoHandover'
import { readLiveRookieOrderSettings, saveLiveRookieOrderSettings } from '@/lib/rookie-order/liveRookieOrderService'
import { readAutomationFacts } from './automationOverviewService'
import { planAutomationPreset, type AutomationPreset, type PresetPlan } from './automationPreset'

export const AUTOMATION_PRESET_ACTION = 'automation_preset.applied'

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export async function previewAutomationPreset(leagueId: string, userId: string, preset: AutomationPreset): Promise<{ ok: true; plan: PresetPlan } | { ok: false; status: number; error: string }> {
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, status: 403, error: 'Forbidden' }
  const read = await readAutomationFacts(leagueId)
  if (!read) return { ok: false, status: 404, error: 'League not found' }
  if (!read.native) return { ok: false, status: 409, error: 'Automations run in leagues AllFantasy runs.' }
  return { ok: true, plan: planAutomationPreset(preset, read.facts) }
}

export async function applyAutomationPreset(leagueId: string, userId: string, preset: AutomationPreset): Promise<{ ok: true; plan: PresetPlan } | { ok: false; status: number; error: string }> {
  const preview = await previewAutomationPreset(leagueId, userId, preset)
  if (!preview.ok) return preview
  const { plan } = preview
  if (plan.changes.length === 0) return { ok: true, plan }
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const next = { ...asRecord(row?.settings) }
    let touched = false
    for (const { step } of plan.changes) {
      switch (step.key) {
        case 'fill_empty_starters':
          next[FILL_EMPTY_STARTERS_KEY] = step.on
          break
        case 'draft_as_me':
          next.draft_as_me = step.on
          break
        case 'eliminated_lineups':
          next[ELIMINATED_LINEUP_RULE_KEY] = step.on ? { enabled: true, standard: 'playable', autoFill: true } : { enabled: false }
          break
        case 'ir_auto_move':
          next[IR_AUTO_MOVE_KEY] = { enabled: step.on }
          break
        case 'rookie_draft_opens':
          next[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY] = { ...asRecord(next[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]), autoOpen: step.on }
          break
        case 'rookie_draft_starts':
          next[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY] = { ...asRecord(next[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]), autoStartDays: step.days }
          break
        case 'auto_handover':
          if (step.rule) next[AUTO_HANDOVER_KEY] = { ...step.rule, since: now.toISOString(), byUserId: userId }
          else delete next[AUTO_HANDOVER_KEY]
          break
        default:
          continue
      }
      touched = true
    }
    if (touched) await tx.league.update({ where: { id: leagueId }, data: { settings: next as Prisma.InputJsonValue } })
  })

  for (const { step } of plan.changes) {
    if (step.key === 'live_rookie_order') {
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, season: true } })
      const current = readLiveRookieOrderSettings(league?.settings)
      await saveLiveRookieOrderSettings(leagueId, { enabled: step.on, config: current.config, season: league?.season ?? now.getUTCFullYear() })
    } else if (step.key === 'tanking_monitor') {
      await prisma.leagueIntegritySettings.upsert({
        where: { leagueId },
        create: { leagueId, tankingMonitorEnabled: step.on },
        update: { tankingMonitorEnabled: step.on },
      })
    }
  }

  await logAction({
    leagueId,
    userId,
    actionType: AUTOMATION_PRESET_ACTION,
    entityType: 'league',
    entityId: leagueId,
    metadata: { preset, changes: plan.changes.map((c) => c.label), skippedNeedsPlan: plan.needsPlan },
  }).catch(() => {})
  return { ok: true, plan }
}
