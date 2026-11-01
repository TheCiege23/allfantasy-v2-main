/**
 * The commissioner's weekly to-do list: one short list of the things only a person can do, built
 * from the league's live state. Chimmy runs the season unattended, so the usual answer is
 * "nothing needed". Every action item matches a condition the engine stops and waits on (or a
 * setup gap that keeps the draft from starting); anything the engine will settle by itself is a
 * heads-up, never a chore. Spoiler-safe: no ballot, tally or idol holder is ever named. Pure and
 * client-safe.
 */

export type SurvivorCommissionerTodoTone = 'action' | 'heads_up'

export type SurvivorCommissionerTodoItem = {
  id: string
  tone: SurvivorCommissionerTodoTone
  title: string
  body: string
  href: string
  cta: string
}

export type SurvivorCommissionerTodo = {
  week: number | null
  /** One line for the top of the card. */
  headline: string
  /** Action items first, then heads-ups. */
  items: SurvivorCommissionerTodoItem[]
  actionCount: number
}

export type SurvivorCommissionerTodoFacts = {
  leagueId: string
  week: number | null
  phase: string | null
  /** Draft status, or null when no draft session exists yet. */
  draftStatus: string | null
  leagueSize: number | null
  claimedManagers: number
  /** Setup mismatches that hold the draft (seat and automation lines are handled separately). */
  setupIssues: string[]
  /** `SurvivorGameState.lastError`, including a `PAUSED:` marker. */
  lastError: string | null
  paused: boolean
  autoReveal: boolean
  council: { week: number; status: string; isRevealed: boolean; tiePhase: string | null } | null
  /** Week scores are not final yet (`weekScoringFinalAt` is null). */
  scoresPending: boolean
  /** Commissioner alerts already sent (`kind:dedupeKey`), so the list agrees with the inbox. */
  sentAlertKeys: string[]
  tribeRedrawPending: boolean
}

const PRE_DRAFT = new Set(['pre_draft', 'scheduled'])

export function buildSurvivorCommissionerTodo(facts: SurvivorCommissionerTodoFacts): SurvivorCommissionerTodo {
  const base = `/survivor/${facts.leagueId}`
  const hub = `${base}/commissioner`
  const items: SurvivorCommissionerTodoItem[] = []
  const beforeDraft = facts.draftStatus == null || PRE_DRAFT.has(facts.draftStatus)
  const seasonOver = facts.phase === 'complete'

  if (beforeDraft) {
    const open = facts.leagueSize ? Math.max(0, facts.leagueSize - facts.claimedManagers) : 0
    if (open > 0) {
      items.push({
        id: 'fill_seats', tone: 'action',
        title: `Fill ${open} open seat${open === 1 ? '' : 's'}`,
        body: `${open} of ${facts.leagueSize} seats are still unclaimed. The draft cannot start until every seat has a manager.`,
        href: `/league/${facts.leagueId}?guide=settings`, cta: 'Invite managers',
      })
    }
    if (facts.setupIssues.length) {
      items.push({
        id: 'fix_setup', tone: 'action',
        title: facts.setupIssues.length === 1 ? 'Fix one setup problem before the draft' : `Fix ${facts.setupIssues.length} setup problems before the draft`,
        body: facts.setupIssues.join(' '),
        href: `${hub}?tab=operations`, cta: 'Review setup',
      })
    }
  }

  if (!seasonOver && facts.paused) {
    items.push({
      id: 'resume', tone: 'action',
      title: 'The season is paused',
      body: 'Nothing moves until you resume it: no councils, no scoring, no new week.',
      href: `${hub}?tab=tribal`, cta: 'Resume',
    })
  } else if (!seasonOver && facts.lastError && !facts.lastError.startsWith('PAUSED:')) {
    items.push({
      id: 'automation_error', tone: 'action',
      title: 'Season automation hit an error',
      body: 'Chimmy keeps retrying every few minutes. If it does not clear, look at the error under Operations.',
      href: `${hub}?tab=operations`, cta: 'Open Operations',
    })
  }

  const council = facts.council
  if (council && !council.isRevealed) {
    if (council.status === 'tie_pending' && council.tiePhase === 'commissioner_tiebreak_required') {
      items.push({
        id: 'break_tie', tone: 'action',
        title: `Break the week ${council.week} tie`,
        body: 'The revote and season points both ended level, so the rules hand this one to you. Pick between the tied managers.',
        href: `${base}/tribal`, cta: 'Break the tie',
      })
    } else if (!facts.autoReveal && (council.status === 'closed' || council.status === 'voting_closed')) {
      items.push({
        id: 'read_votes', tone: 'action',
        title: `Read the week ${council.week} votes`,
        body: 'Voting is closed. You turned automatic reveals off, so the island waits for you to read the votes.',
        href: `${base}/tribal`, cta: 'Read the votes',
      })
    }
  }

  // Raised by the season runner once each; still listed while the condition holds.
  if (!seasonOver && facts.week != null && facts.scoresPending && facts.sentAlertKeys.includes(`scores_overdue:${facts.week}`)) {
    items.push({
      id: 'scores_overdue', tone: 'action',
      title: `Week ${facts.week} scores are overdue`,
      body: 'The week ended but its verified scores are still not final. Check the stat feed; the season carries on as soon as they land.',
      href: `${hub}?tab=operations`, cta: 'Open Operations',
    })
  }
  if (!seasonOver && facts.sentAlertKeys.some(key => key.startsWith('jury_overdue:'))) {
    items.push({
      id: 'jury_overdue', tone: 'action',
      title: 'The jury vote needs a look',
      body: 'The jury deadline passed and no winner could be crowned. Review the finale.',
      href: `${base}/jury`, cta: 'Open the finale',
    })
  }

  if (facts.tribeRedrawPending && !seasonOver) {
    items.push({
      id: 'tribe_redraw', tone: 'heads_up',
      title: 'Chimmy suggests redrawing the tribes',
      body: 'The tribes have drifted out of balance. If you do nothing, Chimmy redraws them before the next Tribal Council.',
      href: `${hub}?tab=tribes`, cta: 'See the suggestion',
    })
  }

  const actionCount = items.filter(item => item.tone === 'action').length
  const headline = seasonOver
    ? 'The season is over. Nothing needed.'
    : actionCount === 0
      ? `Nothing needed${facts.week != null && !beforeDraft ? ` for week ${facts.week}` : ''}. Chimmy runs the season; you get an alert if that changes.`
      : actionCount === 1 ? 'One thing needs you.' : `${actionCount} things need you.`
  return { week: facts.week, headline, items: [...items.filter(item => item.tone === 'action'), ...items.filter(item => item.tone !== 'action')], actionCount }
}
