import type { CollegeProDraft } from './drafts'
import type { DraftPipelineReport } from './draftPipeline'

/**
 * The commissioner's offseason checklist for a paired college + pro league, one per draft year.
 *
 * Each step is detected from data where we have it, and ticked by the commissioner where we do not.
 * The hand-ticked ones are hand-ticked for a measured reason, not convenience: moving a drafted
 * player up happens on Sleeper or Fantrax, and nothing on file ties a college (CFBD / ESPN) id to a
 * Sleeper id — 0 of ~12,000 identity rows on either side carry both (2026-11-22). Checking a pro
 * roster for the rookie would mean matching by name, which this codebase does not do.
 *
 * Ticks are stored on the PRO half's `League.settings.collegeProDraftChecklist` as
 * `{ [year]: { [stepId]: { at, by } } }` (AF-owned, so a re-import keeps them).
 */

export const COLLEGE_PRO_DRAFT_CHECKLIST_KEY = 'collegeProDraftChecklist'

export const MANUAL_STEPS = ['moveUp', 'rookiePool', 'collegeCleared'] as const
export type ManualStep = (typeof MANUAL_STEPS)[number]
export type ChecklistStepId = 'results' | ManualStep | 'rookieDraft'

export type ChecklistStep = {
  id: ChecklistStepId
  title: string
  detail: string | null
  /** `waiting`: nothing to do yet (e.g. no draft results). `unknown`: we cannot see it from here. */
  state: 'done' | 'todo' | 'waiting' | 'unknown'
  /** The commissioner ticks it; otherwise it is read from data. */
  manual: boolean
}

export type ChecklistTicks = Partial<Record<ManualStep, { at: string; by: string }>>

export function readChecklistTicks(settings: unknown, year: number): ChecklistTicks {
  const all = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[COLLEGE_PRO_DRAFT_CHECKLIST_KEY] : null
  const forYear = all && typeof all === 'object' ? (all as Record<string, unknown>)[String(year)] : null
  const out: ChecklistTicks = {}
  if (!forYear || typeof forYear !== 'object') return out
  for (const step of MANUAL_STEPS) {
    const t = (forYear as Record<string, unknown>)[step]
    if (t && typeof t === 'object' && typeof (t as { at?: unknown }).at === 'string') {
      out[step] = { at: (t as { at: string }).at, by: String((t as { by?: unknown }).by ?? '') }
    }
  }
  return out
}

/** The settings value after ticking or unticking one step. Merges: other years and steps survive. */
export function withChecklistTick(settings: unknown, year: number, step: ManualStep, done: boolean, by: string, now: Date): Record<string, unknown> {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? { ...(settings as Record<string, unknown>) } : {}
  const all = base[COLLEGE_PRO_DRAFT_CHECKLIST_KEY] && typeof base[COLLEGE_PRO_DRAFT_CHECKLIST_KEY] === 'object'
    ? { ...(base[COLLEGE_PRO_DRAFT_CHECKLIST_KEY] as Record<string, unknown>) }
    : {}
  const forYear = all[String(year)] && typeof all[String(year)] === 'object' ? { ...(all[String(year)] as Record<string, unknown>) } : {}
  if (done) forYear[step] = { at: now.toISOString(), by }
  else delete forYear[step]
  all[String(year)] = forYear
  base[COLLEGE_PRO_DRAFT_CHECKLIST_KEY] = all
  return base
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function buildDraftChecklist(args: {
  report: DraftPipelineReport | null
  ticks: ChecklistTicks
  /** "NFL" / "NBA". */
  proLabel: string
  proLeagueName: string
  proPlatform: string
  collegeLeagueName: string
  /** The pro half's drafts as its provider reports them (Sleeper only today); null when unreadable. */
  proDrafts: CollegeProDraft[] | null
}): ChecklistStep[] {
  const { report, ticks } = args
  const platform = args.proPlatform === 'fantrax' ? 'Fantrax' : args.proPlatform === 'sleeper' ? 'Sleeper' : 'your platform'
  if (!report) {
    return [{ id: 'results', title: `${args.proLabel} draft results`, detail: 'Not in yet. This list fills in once they are.', state: 'waiting', manual: false }]
  }
  const moving = report.movingUp.reduce((n, f) => n + f.players.length, 0)
  const unmatched = report.movingUp.filter((f) => !f.proKey).length
  const tick = (step: ManualStep): ChecklistStep['state'] => (ticks[step] ? 'done' : 'todo')

  const steps: ChecklistStep[] = [
    {
      id: 'results',
      title: `${report.year} ${args.proLabel} draft results are in`,
      detail: `${plural(moving, 'player')} from ${args.collegeLeagueName} ${moving === 1 ? 'was' : 'were'} drafted.${report.unlinked ? ` ${plural(report.unlinked, 'pick')} could not be checked.` : ''}`,
      state: 'done',
      manual: false,
    },
    moving === 0
      ? { id: 'moveUp', title: 'Move drafted players up', detail: 'None of your college players were drafted.', state: 'done', manual: false }
      : {
          id: 'moveUp',
          title: `Move ${plural(moving, 'drafted player')} to ${args.proLeagueName}`,
          detail: `Add each one to his manager's ${args.proLabel} roster on ${platform}.${unmatched ? ` ${plural(unmatched, 'college team')} ${unmatched === 1 ? 'has' : 'have'} no matching ${args.proLabel} team yet.` : ''}`,
          state: tick('moveUp'),
          manual: true,
        },
    {
      id: 'rookiePool',
      title: `Set the rookie draft pool: ${plural(report.rookiePool.length, 'player')}`,
      detail: `Drafted players no college team held. Add them to the rookie draft on ${platform}.`,
      state: report.rookiePool.length === 0 ? 'done' : tick('rookiePool'),
      manual: report.rookiePool.length > 0,
    },
    moving === 0
      ? { id: 'collegeCleared', title: `Clear drafted players from ${args.collegeLeagueName}`, detail: 'Nobody to clear.', state: 'done', manual: false }
      : {
          id: 'collegeCleared',
          title: `Clear drafted players from ${args.collegeLeagueName}`,
          detail: 'Drop them from their college rosters so those spots open up.',
          state: tick('collegeCleared'),
          manual: true,
        },
    rookieDraftStep(args.proDrafts, report.year, platform),
  ]
  return steps
}

function rookieDraftStep(drafts: CollegeProDraft[] | null, year: number, platform: string): ChecklistStep {
  const base = { id: 'rookieDraft' as const, title: 'Schedule the rookie draft', manual: false }
  if (!drafts) return { ...base, detail: `Check the draft on ${platform}.`, state: 'unknown' }
  const pro = drafts.filter((d) => d.role === 'pro' && (d.season ?? 0) >= year)
  const ran = pro.find((d) => d.phase === 'done' || d.phase === 'live')
  if (ran) return { ...base, title: 'Rookie draft', detail: ran.phase === 'live' ? 'Live now.' : 'Done.', state: 'done' }
  const next = pro.find((d) => d.phase === 'upcoming')
  if (next?.startsAt) {
    const when = new Date(next.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    return { ...base, title: 'Rookie draft scheduled', detail: `Starts ${when}.`, state: 'done' }
  }
  if (next) return { ...base, detail: `It has no start date yet. Set one on ${platform}.`, state: 'todo' }
  return { ...base, detail: `No ${year} rookie draft on ${platform} yet.`, state: 'todo' }
}
