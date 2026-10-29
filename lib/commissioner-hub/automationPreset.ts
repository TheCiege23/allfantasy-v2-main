/**
 * Automation presets — "the commissioner chooses once" (phase 10, 2026-10-29). One choice switches on
 * a sensible set of automations instead of visiting ten cards:
 *
 *   recommended  every automation that keeps a league fair and running without changing a rule nobody
 *                picked: fill empty spots, draft as me, lineup minimums for eliminated teams, IR
 *                auto-move, the anti-tanking monitor, and (dynasty) the rookie draft opening itself,
 *                starting itself 7 days later, and its order kept up to date
 *   run_it       recommended, plus handing a team with no activity for 14 days to Chimmy autopilot
 *                (to AllFantasy lineups without AF Commissioner)
 *   hands_on     nothing runs on its own: empty spots are not filled and no team is handed over
 *
 * Left out of every preset on purpose: taxi rule enforcement (it applies stored rules nobody chose, see
 * lib/taxi/taxiMoveRules.ts) and the hold-flagged-trades mode (already on for serious flags by default).
 *
 * Pure: `planAutomationPreset` says what would change, so the commissioner sees it before saving. An
 * automation that needs AF Commissioner is listed as skipped when the league owner does not have it.
 */
import { fillEmptyStartersOn } from '@/lib/lineup-automation/fillEmptyStarters'
import { readEliminatedLineupRule } from '@/lib/eliminated-lineups/eliminatedLineups'
import { readIrAutoMoveEnabled } from '@/lib/ir-activation/irAutoMove'
import { readRookieDraftCalendarSettings } from '@/lib/dynasty-core/rookieDraftCalendar'
import { readAutoHandover, type AutoHandoverTarget } from '@/lib/inactive-manager/autoHandover'

export const AUTOMATION_PRESETS = ['recommended', 'run_it', 'hands_on'] as const
export type AutomationPreset = (typeof AUTOMATION_PRESETS)[number]

export function isAutomationPreset(v: unknown): v is AutomationPreset {
  return typeof v === 'string' && (AUTOMATION_PRESETS as readonly string[]).includes(v)
}

export type PresetFacts = {
  settings: unknown
  dynasty: boolean
  commissionerPlan: boolean
  rookieDraftAutoOpen: boolean
  liveRookieOrderOn: boolean
  tankingMonitorOn: boolean
}

export type PresetStep =
  | { key: 'fill_empty_starters'; on: boolean }
  | { key: 'draft_as_me'; on: boolean }
  | { key: 'eliminated_lineups'; on: boolean }
  | { key: 'ir_auto_move'; on: boolean }
  | { key: 'tanking_monitor'; on: boolean }
  | { key: 'rookie_draft_opens'; on: boolean }
  | { key: 'rookie_draft_starts'; days: 7 | null }
  | { key: 'live_rookie_order'; on: boolean }
  | { key: 'auto_handover'; rule: { days: 14; to: AutoHandoverTarget } | null }

export type PresetPlan = {
  preset: AutomationPreset
  /** What saving will change, in order. Steps already in place are not listed. */
  changes: Array<{ step: PresetStep; label: string }>
  /** Steps the preset includes that need AF Commissioner, which the league owner does not have. */
  needsPlan: string[]
}

const LABELS: Record<PresetStep['key'], string> = {
  fill_empty_starters: 'Fill empty starting spots before lock',
  draft_as_me: 'Missed picks made the way the manager drafts',
  eliminated_lineups: 'Lineup minimums for eliminated teams',
  ir_auto_move: 'Move healthy players off IR',
  tanking_monitor: 'Anti-tanking monitor',
  rookie_draft_opens: 'Rookie draft opens itself',
  rookie_draft_starts: 'Rookie draft starts itself 7 days after it opens',
  live_rookie_order: 'Rookie draft order kept up to date',
  auto_handover: 'Hand over a team after 14 days with no activity',
}

const PAID: ReadonlySet<PresetStep['key']> = new Set(['draft_as_me', 'eliminated_lineups', 'ir_auto_move', 'tanking_monitor', 'live_rookie_order'])

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function planAutomationPreset(preset: AutomationPreset, f: PresetFacts): PresetPlan {
  const wanted: PresetStep[] = []
  if (preset === 'hands_on') {
    wanted.push({ key: 'fill_empty_starters', on: false }, { key: 'auto_handover', rule: null })
  } else {
    wanted.push(
      { key: 'fill_empty_starters', on: true },
      { key: 'draft_as_me', on: true },
      { key: 'eliminated_lineups', on: true },
      { key: 'ir_auto_move', on: true },
      { key: 'tanking_monitor', on: true },
    )
    if (f.dynasty) {
      wanted.push({ key: 'rookie_draft_opens', on: true }, { key: 'rookie_draft_starts', days: 7 }, { key: 'live_rookie_order', on: true })
    }
    if (preset === 'run_it') wanted.push({ key: 'auto_handover', rule: { days: 14, to: f.commissionerPlan ? 'autopilot' : 'lineups' } })
  }

  const handover = readAutoHandover(f.settings)
  const current = (step: PresetStep): boolean => {
    switch (step.key) {
      case 'fill_empty_starters':
        return fillEmptyStartersOn(f.settings) === step.on
      case 'draft_as_me':
        // On by default; it only counts as on with the plan.
        return (asRecord(f.settings).draft_as_me !== false) === step.on && (!step.on || f.commissionerPlan)
      case 'eliminated_lineups':
        return Boolean(readEliminatedLineupRule(f.settings)) === step.on
      case 'ir_auto_move':
        return readIrAutoMoveEnabled(f.settings) === step.on
      case 'tanking_monitor':
        return f.tankingMonitorOn === step.on
      case 'rookie_draft_opens':
        return f.rookieDraftAutoOpen === step.on
      case 'rookie_draft_starts':
        return readRookieDraftCalendarSettings(f.settings).autoStartDays === step.days
      case 'live_rookie_order':
        return f.liveRookieOrderOn === step.on
      case 'auto_handover':
        return step.rule === null ? handover === null : handover?.days === step.rule.days && handover.to === step.rule.to
    }
  }

  const plan: PresetPlan = { preset, changes: [], needsPlan: [] }
  for (const step of wanted) {
    const turningOn = !('on' in step) || step.on
    if (PAID.has(step.key) && turningOn && !f.commissionerPlan) {
      plan.needsPlan.push(LABELS[step.key])
      continue
    }
    if (current(step)) continue
    plan.changes.push({ step, label: hands(step) })
  }
  return plan
}

function hands(step: PresetStep): string {
  if (step.key === 'auto_handover') return step.rule ? `${LABELS.auto_handover}, to ${step.rule.to === 'autopilot' ? 'Chimmy autopilot' : 'AllFantasy'}` : 'Stop handing over teams with no activity'
  if ('on' in step && !step.on) return `Turn off: ${LABELS[step.key].toLowerCase()}`
  return LABELS[step.key]
}
