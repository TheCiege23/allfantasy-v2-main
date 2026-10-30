import 'server-only'

import { prisma } from '@/lib/prisma'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { readAutomationFacts } from '@/lib/commissioner-hub/automationOverviewService'
import { applyAutomationPreset, previewAutomationPreset } from '@/lib/commissioner-hub/automationPresetService'
import { isAutomationPreset, type AutomationPreset } from '@/lib/commissioner-hub/automationPreset'
import { readAutoHandover, AUTO_HANDOVER_DAYS, type AutoHandoverDays, type AutoHandoverTarget } from '@/lib/inactive-manager/autoHandover'
import { setAutoHandover } from '@/lib/inactive-manager/inactiveManagerService'
import { signChimmyActionToken } from './actionToken'
import type { AutomationChangeSpec, ChimmyActionCard, ChimmyActionTokenPayload } from './types'

/**
 * "Turn on the recommended setup" / "hand quiet teams over after 14 days" — a commissioner asking
 * Chimmy to switch a league automation (phase 12, 2026-10-29).
 *
 * PROPOSE builds a confirm card listing exactly what will change; EXECUTE (only from the confirm
 * route, after the tap) saves through the same services the Commissioner Hub's cards use —
 * `applyAutomationPreset` and `setAutoHandover` — with their own permission and plan checks.
 *
 * ⚠ THE CARD IS CHECKED AGAINST THE LEAGUE AT CONFIRM TIME. A preset is re-planned when the tap
 * arrives; if what it would change is no longer what the card listed (a co-commissioner saved
 * something in between), nothing is saved and the commissioner asks again.
 */

type Outcome = { ok: true; text: string; card: ChimmyActionCard } | { ok: false; text: string }

const PRESET_TITLE: Record<AutomationPreset, string> = {
  recommended: 'Turn on the recommended automations',
  run_it: 'Let AllFantasy run the league',
  hands_on: 'Switch to hands-on (nothing runs on its own)',
}

const TARGET_WORDS: Record<AutoHandoverTarget, string> = {
  lineups: 'AllFantasy sets its lineups',
  autopilot: 'Chimmy autopilot runs it',
}

function handoverKey(rule: { days: number; to: string } | null): string {
  return rule ? `handover:${rule.days}:${rule.to}` : 'handover:off'
}

function parseDays(v: unknown): AutoHandoverDays | 0 | null {
  const n = typeof v === 'string' ? Number(v) : v
  if (n === 0) return 0
  return (AUTO_HANDOVER_DAYS as readonly unknown[]).includes(n) ? (n as AutoHandoverDays) : null
}

export async function proposeAutomationChange(args: {
  leagueId: string
  userId: string
  preset?: unknown
  handoverDays?: unknown
  handoverTo?: unknown
  now?: Date
}): Promise<Outcome> {
  const now = args.now ?? new Date()
  const wantsPreset = args.preset !== undefined && args.preset !== null && args.preset !== ''
  const wantsHandover = args.handoverDays !== undefined && args.handoverDays !== null && args.handoverDays !== ''
  if (wantsPreset === wantsHandover) {
    return { ok: false, text: 'Pass exactly one of: preset (recommended, run_it or hands_on), or handover_days (7, 14, 21, or 0 to turn it off). Nothing was prepared.' }
  }
  if (!(await isElevatedCommissioner(args.leagueId, args.userId))) {
    return { ok: false, text: "Only this league's commissioner or a co-commissioner can change its automations, so nothing was prepared. Say so plainly; the user can ask their commissioner." }
  }
  const read = await readAutomationFacts(args.leagueId)
  if (!read) return { ok: false, text: 'That league could not be found, so nothing was prepared.' }
  if (!read.native) return { ok: false, text: 'Automations only run in leagues AllFantasy runs; this league is imported, so nothing was prepared. Its settings are changed on the platform it came from.' }

  let change: AutomationChangeSpec
  let lines: string[]
  let expectedKeys: string[]
  let title: string
  const warnings: string[] = []

  if (wantsPreset) {
    if (!isAutomationPreset(args.preset)) return { ok: false, text: 'preset must be recommended, run_it or hands_on. Nothing was prepared.' }
    const preview = await previewAutomationPreset(args.leagueId, args.userId, args.preset)
    if (!preview.ok) return { ok: false, text: `That preset could not be prepared (${preview.error}). Nothing was changed.` }
    if (preview.plan.changes.length === 0) {
      return { ok: false, text: `Everything in that setup is already in place in this league, so there is nothing to change. Tell the user so.${preview.plan.needsPlan.length ? ` Skipped without AF Commissioner: ${preview.plan.needsPlan.join('; ')}.` : ''}` }
    }
    change = { type: 'preset', preset: args.preset }
    lines = preview.plan.changes.map((c) => c.label)
    expectedKeys = preview.plan.changes.map((c) => c.step.key)
    title = PRESET_TITLE[args.preset]
    if (preview.plan.needsPlan.length) warnings.push(`Left off — needs the league owner's AF Commissioner plan: ${preview.plan.needsPlan.join('; ')}.`)
  } else {
    const days = parseDays(args.handoverDays)
    if (days === null) return { ok: false, text: 'handover_days must be 7, 14 or 21 (or 0 to turn it off). Nothing was prepared.' }
    const current = readAutoHandover(read.facts.settings)
    if (days === 0) {
      if (!current) return { ok: false, text: 'Handing quiet teams over is already off in this league, so there is nothing to change.' }
      change = { type: 'handover', rule: null }
      lines = ['Stop handing quiet teams to AllFantasy (teams already handed over stay that way until their owner is back)']
      title = 'Stop handing over quiet teams'
    } else {
      const asked = args.handoverTo === 'autopilot' || args.handoverTo === 'lineups' ? (args.handoverTo as AutoHandoverTarget) : null
      if (asked === 'autopilot' && !read.facts.commissionerPlan) {
        return { ok: false, text: "Handing teams to Chimmy autopilot needs the league owner's AF Commissioner plan, which this league does not have. Nothing was prepared. Offer lineup management instead (free): handover_to 'lineups'." }
      }
      const to: AutoHandoverTarget = asked ?? (read.facts.commissionerPlan ? 'autopilot' : 'lineups')
      if (current && current.days === days && current.to === to) {
        return { ok: false, text: `That rule is already on (after ${days} days, ${TARGET_WORDS[to]}), so there is nothing to change.` }
      }
      change = { type: 'handover', rule: { days, to } }
      lines = [`After ${days} days with no activity from its owner, a team is handed over — ${TARGET_WORDS[to]}`]
      title = 'Hand over quiet teams'
      warnings.push('It ends for a team the moment its owner saves a lineup. Idle time counts from when you switch this on.')
    }
    expectedKeys = [handoverKey(change.rule)]
  }

  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { name: true, sport: true, season: true } })
  const signed = signChimmyActionToken({
    userId: args.userId,
    leagueId: args.leagueId,
    spec: { kind: 'automation', change, expectedKeys },
    now,
  })
  if (!signed) return { ok: false, text: 'Confirm cards are unavailable right now, so nothing was prepared. The commissioner can change this in the Commissioner Hub.' }
  const card: ChimmyActionCard = {
    actionId: signed.payload.actionId,
    kind: 'automation',
    token: signed.token,
    title,
    league: { id: args.leagueId, name: league?.name ?? null, sport: String(league?.sport ?? '') },
    week: 0,
    season: league?.season ?? now.getUTCFullYear(),
    expiresAt: new Date(signed.payload.exp * 1000).toISOString(),
    automation: { changes: lines },
    warnings,
  }
  return {
    ok: true,
    text: `A confirm card is ready. Saving it will: ${lines.join('; ')}. NOTHING has changed yet — it is saved only if the commissioner taps Confirm. Say that, and never say it was switched on.`,
    card,
  }
}

export type AutomationExecuteResult = { ok: true; message: string } | { ok: false; message: string }

const sameKeys = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

const CHANGED = 'Your league changed since this card was made, so nothing was saved. Ask Chimmy again for a fresh card.'

export async function executeAutomationAction(payload: ChimmyActionTokenPayload, userId: string): Promise<AutomationExecuteResult> {
  const spec = payload.spec
  if (spec.kind !== 'automation') return { ok: false, message: 'This card could not be applied.' }
  const { leagueId } = payload

  if (spec.change.type === 'preset') {
    const preset = spec.change.preset
    const preview = await previewAutomationPreset(leagueId, userId, preset)
    if (!preview.ok) return { ok: false, message: preview.status === 403 ? 'Only the commissioner can change automations, so nothing was saved.' : `Nothing was saved: ${preview.error}` }
    if (!sameKeys(preview.plan.changes.map((c) => c.step.key), spec.expectedKeys)) return { ok: false, message: CHANGED }
    const applied = await applyAutomationPreset(leagueId, userId, preset)
    if (!applied.ok) return { ok: false, message: `Nothing was saved: ${applied.error}` }
    return { ok: true, message: `Saved — ${applied.plan.changes.length} automation setting${applied.plan.changes.length === 1 ? '' : 's'} changed.` }
  }

  const rule = spec.change.rule
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, message: 'Only the commissioner can change automations, so nothing was saved.' }
  const read = await readAutomationFacts(leagueId)
  if (!read || !read.native) return { ok: false, message: 'Nothing was saved: this league is not run by AllFantasy.' }
  const current = readAutoHandover(read.facts.settings)
  // Saving the same rule again would restart every team's idle clock, so an unchanged rule is not re-saved.
  if (handoverKey(current) === handoverKey(rule)) return { ok: false, message: 'That rule is already in place, so nothing was saved.' }
  const saved = await setAutoHandover(leagueId, userId, rule)
  if (!saved.ok) return { ok: false, message: `Nothing was saved: ${saved.error}` }
  return {
    ok: true,
    message: saved.rule ? `Saved — quiet teams are handed over after ${saved.rule.days} days.` : 'Saved — quiet teams are no longer handed over.',
  }
}
