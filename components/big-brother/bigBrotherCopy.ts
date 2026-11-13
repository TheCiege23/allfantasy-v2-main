/**
 * Plain-language copy for Big Brother codes that used to reach the screen raw (2026-11-09 audit): the HOH view
 * printed "Phase: VOTING_OPEN", and the History view printed each audit row as its event code
 * ("veto_winner") over a JSON dump of its metadata — roster ids and all.
 *
 * Presentation only. Vote totals are never described here; what a viewer may see of them is decided server-side
 * by `redactBigBrotherAuditForViewer` (lib/big-brother/auditVisibility.ts).
 */

const PHASE_LABELS: Record<string, string> = {
  HOH_OPEN: 'HOH competition',
  HOH_LOCKED: 'HOH decided',
  NOMINATION_OPEN: 'Nominations open',
  NOMINATION_LOCKED: 'Nominations locked',
  VETO_DRAW: 'Veto draw',
  VETO_CHALLENGE_OPEN: 'Veto competition',
  VETO_DECISION_OPEN: 'Veto meeting',
  REPLACEMENT_NOMINATION_OPEN: 'Replacement nomination',
  VOTING_OPEN: 'Eviction vote open',
  VOTING_LOCKED: 'Votes locked',
  EVICTION_RESOLVED: 'Eviction complete',
  JURY_UPDATE: 'Jury update',
}

/** "voting_open" / "VOTING_OPEN" / "replace_inactive_hoh" → "Voting open" / "Replace inactive hoh". */
export function humanizeCode(code: string): string {
  const s = code.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return s ? s[0]!.toUpperCase() + s.slice(1) : ''
}

export function bigBrotherPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return '—'
  return PHASE_LABELS[phase] ?? humanizeCode(phase)
}

const EVENT_TITLES: Record<string, string> = {
  hoh_assigned: 'Head of Household',
  nomination: 'Nominations',
  veto_draw: 'Veto draw',
  veto_winner: 'Veto won',
  veto_used: 'Veto used',
  replacement_nominee: 'Replacement nominee',
  eviction_vote_submitted: 'Vote cast',
  eviction: 'Eviction',
  jury_enrolled: 'Joined the jury',
  finale_vote: 'Finale',
  phase_transition: 'House update',
  auto_nomination: 'Automatic nominations',
  auto_replacement_nominee: 'Automatic replacement nominee',
  roster_archived: 'Roster archived',
}

type Meta = Record<string, unknown>

/**
 * One house-log row as a title and a sentence. Names come from the league's roster names; a roster id with no
 * name reads "a houseguest", never the id. Commissioner actions are named by what they did.
 */
export function describeBigBrotherAuditEvent(
  row: { eventType: string; metadata: unknown },
  names: Record<string, string>,
): { title: string; detail: string | null } {
  const m: Meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Meta) : {}
  const who = (v: unknown) => (typeof v === 'string' && v ? names[v] ?? 'a houseguest' : null)
  const week = typeof m.week === 'number' ? m.week : typeof m.evictedWeek === 'number' ? m.evictedWeek : null
  const wk = week != null ? `Week ${week}: ` : ''
  const title = EVENT_TITLES[row.eventType] ?? humanizeCode(row.eventType)

  const one = who(m.rosterId) ?? who(m.hohRosterId) ?? who(m.winnerRosterId)
  const n1 = who(m.nominee1RosterId)
  const n2 = who(m.nominee2RosterId)
  let detail: string | null = null
  switch (row.eventType) {
    case 'hoh_assigned':
      detail = one ? `${wk}${one} is Head of Household.` : null
      break
    case 'nomination':
    case 'auto_nomination':
      detail = n1 && n2 ? `${wk}${n1} and ${n2} are on the block.` : null
      break
    case 'veto_winner':
      detail = one ? `${wk}${one} won the Veto.` : null
      break
    case 'veto_used': {
      const saved = who(m.vetoSavedRosterId) ?? who(m.savedRosterId)
      detail = saved ? `${wk}The Veto saved ${saved}.` : null
      break
    }
    case 'replacement_nominee':
    case 'auto_replacement_nominee': {
      const r = who(m.replacementNomineeRosterId) ?? one
      detail = r ? `${wk}${r} went on the block.` : null
      break
    }
    case 'eviction': {
      const out = who(m.evictedRosterId)
      detail = out ? `${wk}${out} was evicted.` : null
      break
    }
    case 'jury_enrolled':
      detail = one ? `${wk}${one} joined the jury.` : null
      break
    case 'finale_vote':
      detail = one ? `${one} won the season.` : null
      break
    case 'eviction_vote_submitted':
      // A ballot is private: say that one was cast, never by whom or for whom.
      detail = week != null ? `Week ${week}` : null
      break
    default: {
      const action = typeof m.adminAction === 'string' ? m.adminAction : typeof m.event === 'string' ? m.event : null
      if (action) detail = `${wk}${humanizeCode(action)}`
      else if (week != null) detail = `Week ${week}`
    }
  }
  if (!detail && week != null) detail = `Week ${week}`
  return { title, detail }
}
