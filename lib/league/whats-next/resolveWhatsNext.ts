/**
 * Facts + viewer → the banner. Pure, so every phase × audience combination is unit-tested
 * (__tests__/league/whats-next.test.ts) without a league.
 *
 * Audiences, in priority order:
 *   actor         the league is waiting on the viewer (or every manager has something to do)
 *   done          the viewer was asked and already did it
 *   involved      the viewer is in this phase without anything to do (on the block, in a tie)
 *   commissioner  the commissioner, when someone else is acting
 *   member        everyone else
 */
import { FORMAT_GUIDES } from './formatPhaseGuides'
import type { PhaseAction, PhaseGuide, WhatsNextFacts, WhatsNextView, WhatsNextViewer } from './types'

/** What a missing template value reads as. A raw `{hoh}` must never reach a manager. */
const PLACEHOLDER_FALLBACKS: Record<string, string> = {
  hoh: 'the HOH',
  nominees: 'two houseguests',
  nomineeCount: '2',
  vetoHolder: 'The veto holder',
  vetoSaved: 'a nominee',
  vetoPlayers: 'the veto players',
  evicted: 'A houseguest',
  finalists: 'the final houseguests',
  tribe: 'A tribe',
  winner: 'The winner',
  juryVotes: 'votes coming',
  survivorCount: 'the',
  teamsLeft: 'the remaining',
  chopStartWeek: 'a later week',
  claimant: 'The winning manager',
  victim: 'the team they beat',
  roleAdvice: 'Set your lineup. Any survivor who loses to a zombie becomes one.',
  chopAdvice: 'Set your lineup. The lowest score this week is chopped.',
  leagueId: '',
  platform: 'the host platform',
  // An empty URL fails the https check, so the button is dropped rather than pointing nowhere.
  hostLeagueUrl: '',
  hostLineupUrl: '',
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Fill `{name}` placeholders. A "Week {week}" with no week is dropped rather than rendered as
 * "Week :", and the sentence is re-capitalised.
 */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined> = {}): string {
  let text = template
  if (!present(vars.week)) {
    text = text.replace(/:\s*Week \{week\}/g, '').replace(/Week \{week\}(:\s*|\s+)/g, '').replace(/Week \{week\}/g, 'This week')
  }
  text = text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key]
    if (present(value)) return value
    return PLACEHOLDER_FALLBACKS[key] ?? ''
  })
  text = text.replace(/\s{2,}/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function fillAction(action: PhaseAction | undefined, vars: Record<string, string | null | undefined>): PhaseAction | null {
  if (!action) return null
  if (action.external) {
    // A whole URL from the source-link resolver: substituted as-is, and only ever https.
    const href = (action.href ?? '').replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
    if (!/^https:\/\/[^\s]+$/.test(href)) return null
    return { ...action, href, label: fillTemplate(action.label, vars) }
  }
  return {
    ...action,
    label: fillTemplate(action.label, vars),
    ...(action.href ? { href: action.href.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(vars[key] ?? '')) } : {}),
  }
}

function getPhaseGuide(facts: Pick<WhatsNextFacts, 'format' | 'phase'>): PhaseGuide | null {
  return FORMAT_GUIDES[facts.format]?.phases[facts.phase] ?? null
}

export function resolveWhatsNext(facts: WhatsNextFacts, viewer: WhatsNextViewer): WhatsNextView | null {
  const guide = getPhaseGuide(facts)
  if (!guide) return null
  const vars = { ...facts.vars, week: facts.week != null ? String(facts.week) : facts.vars?.week }
  const fill = (s: string | undefined) => (s ? fillTemplate(s, vars) : '')

  const viewerActs =
    (guide.actor === 'viewer_decides' && facts.viewerIsActor === true && facts.viewerDone !== true) ||
    (guide.actor === 'everyone' && viewer.hasTeam !== false) ||
    (guide.actor === 'commissioner' && viewer.isCommissioner)
  const viewerDone = guide.actor === 'viewer_decides' && facts.viewerIsActor === true && facts.viewerDone === true

  let role: WhatsNextView['role']
  let status: WhatsNextView['status']
  let message: string
  let action: PhaseAction | null = null
  let commissionerNote: string | null = null

  if (viewerActs) {
    role = 'actor'
    status = 'act'
    message = fill(guide.actorMessage ?? guide.memberMessage)
    action = fillAction(guide.action, vars)
    // A playing commissioner in an every-manager phase also gets the league-level line.
    if (guide.actor === 'everyone' && viewer.isCommissioner) commissionerNote = fill(guide.commissionerMessage)
  } else if (viewerDone) {
    role = 'actor'
    status = 'done'
    message = guide.doneMessage ? fill(guide.doneMessage) : `You're done for now. ${fill(guide.memberMessage)}`
  } else if (facts.viewerIsInvolved && guide.involvedMessage) {
    role = 'involved'
    status = 'wait'
    message = fill(guide.involvedMessage)
  } else if (viewer.isCommissioner) {
    role = 'commissioner'
    status = 'wait'
    message = fill(guide.commissionerMessage)
    action = fillAction(guide.commissionerAction, vars)
  } else {
    role = 'member'
    status = 'wait'
    message = fill(guide.memberMessage)
  }

  // An automatic phase's button only LOOKS at something ("Watch the reveal"), so anyone may have it.
  if (!action && guide.actor === 'automatic' && guide.action) action = fillAction(guide.action, vars)

  const waitingOn = status === 'wait' && guide.waitingOn ? fill(guide.waitingOn) : null

  return {
    format: facts.format,
    formatLabel: present(facts.formatLabel) ? facts.formatLabel : FORMAT_GUIDES[facts.format].label,
    phase: facts.phase,
    title: fill(guide.title),
    role,
    status,
    shared: status === 'act' && guide.actor === 'everyone',
    message,
    commissionerNote,
    waitingOn,
    deadlineIso: present(facts.deadlineIso) ? facts.deadlineIso : null,
    deadlineLabel: present(facts.deadlineLabel) ? facts.deadlineLabel : null,
    action,
  }
}
