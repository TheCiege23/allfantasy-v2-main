/**
 * "Set up your league in 5 decisions" — the first thing a commissioner sees on League Settings
 * before the draft. Sleeper asks a new commissioner a handful of questions; we had a list of 25
 * rows and no idea which ones mattered. These five are the ones that change how the league plays:
 * everything else has a sensible default and can wait.
 *
 * Pure: the questions read their current answers from the same rows the settings list shows
 * (buildLeagueSettingsHome), and "Change it" opens the same editor that row opens. Nothing here
 * saves a setting. What it remembers is which decisions the commissioner has looked at and kept,
 * per league, in this browser.
 */
import type { SettingsHomeSection, SettingsSubPageId } from './buildLeagueSettingsHome'

export type SetupDecisionId = 'teams' | 'roster' | 'scoring' | 'draft' | 'waivers'

export type SetupDecision = {
  id: SetupDecisionId
  /** Short name for the step list. */
  label: string
  question: string
  /** One line on why this one matters, in commissioner words. */
  why: string
  /** The current answer, exactly as the settings list shows it. */
  value: string
  /** Still loading — "Keep this" waits until there is something to keep. */
  pending: boolean
  target: SettingsSubPageId
}

type Spec = { id: SetupDecisionId; label: string; question: string; why: string; rows: string[] }

const SPECS: readonly Spec[] = [
  {
    id: 'teams',
    label: 'Teams',
    question: 'How many teams?',
    why: 'Sets the draft order and the schedule. Easiest to change before anyone joins.',
    rows: ['teams'],
  },
  {
    id: 'roster',
    label: 'Roster',
    question: 'Which positions does each team play?',
    why: 'Your roster sets how many rounds the draft has, so decide it first.',
    rows: ['roster'],
  },
  {
    id: 'scoring',
    label: 'Scoring',
    question: 'How do players score?',
    why: 'Changes who is worth drafting. Managers plan around it, so settle it early.',
    rows: ['scoring'],
  },
  {
    id: 'draft',
    label: 'Draft',
    question: 'When and how do you draft?',
    why: 'Managers get reminders for this time. Snake suits most leagues; auction adds a budget.',
    rows: ['draft-date', 'draft-shape'],
  },
  {
    id: 'waivers',
    label: 'Waivers',
    question: 'How do free agents get claimed?',
    why: 'Rolling waivers favour the teams in last place; a free-agent budget lets everyone bid.',
    rows: ['waivers'],
  },
]

export const SETUP_DECISION_COUNT = SPECS.length

/**
 * The five decisions, answered from the settings list. A decision whose row the viewer cannot edit
 * (no `target`) is left out, so a co-commissioner without that power is never asked it.
 */
export function buildSetupDecisions(sections: readonly SettingsHomeSection[]): SetupDecision[] {
  const rows = new Map(sections.flatMap((s) => s.rows).map((r) => [r.id, r]))
  const out: SetupDecision[] = []
  for (const spec of SPECS) {
    const found = spec.rows.map((id) => rows.get(id)).filter((r): r is NonNullable<typeof r> => r != null)
    const target = found.find((r) => r.target)?.target
    if (!found.length || !target) continue
    out.push({
      id: spec.id,
      label: spec.label,
      question: spec.question,
      why: spec.why,
      value: found.map((r) => r.value).join(' · '),
      pending: found.some((r) => r.pending),
      target,
    })
  }
  return out
}

export type SetupProgress = { kept: SetupDecisionId[]; dismissed: boolean }

const EMPTY: SetupProgress = { kept: [], dismissed: false }
const storageKey = (leagueId: string) => `af:league-setup-decisions:v1:${leagueId}`
const IDS = new Set<string>(SPECS.map((s) => s.id))

/** Never throws: a private window or blocked storage reads as "nothing decided yet". */
export function readSetupProgress(leagueId: string): SetupProgress {
  try {
    const raw = window.localStorage.getItem(storageKey(leagueId))
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<SetupProgress>
    const kept = Array.isArray(parsed.kept) ? parsed.kept.filter((id): id is SetupDecisionId => IDS.has(String(id))) : []
    return { kept: [...new Set(kept)], dismissed: parsed.dismissed === true }
  } catch {
    return EMPTY
  }
}

export function writeSetupProgress(leagueId: string, progress: SetupProgress): void {
  try {
    window.localStorage.setItem(storageKey(leagueId), JSON.stringify(progress))
  } catch {
    /* the card still works for this visit */
  }
}

/** The first decision not yet kept, in the order above; null when all are done. */
export function nextSetupDecision(decisions: readonly SetupDecision[], kept: readonly SetupDecisionId[]): SetupDecision | null {
  return decisions.find((d) => !kept.includes(d.id)) ?? null
}
