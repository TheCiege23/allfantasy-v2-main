/**
 * Who has heard about a rule change, for Chimmy and Commish OS. Pure: ./awarenessService.ts reads the
 * rows and hands them here.
 *
 *   Chimmy      the league's recent rule changes in plain English, newest first, each marked when the
 *               asking manager has not seen it yet — so "what changed in my league?" has an answer
 *               built from the same events and sentences as the "What changed" card.
 *   Commish OS  one task while members have not seen the newest change. It meets the task bar in
 *               lib/commissioner-workspace/taskSources.ts: MEASURED from each member's seen marker
 *               (the one the card writes), ACTIONABLE (an announcement from the Commissioner Hub), and
 *               SELF-CLEARING — every member who dismisses the card or opens the popup drops off the
 *               count, and the task closes when none are left or the change is two weeks old.
 */

import { translations } from '@/lib/i18n/translations'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'
import { renderChangeLine } from './render'
import { isSettingsEventSeen, type LeagueRulesSeen } from './view'
import type { ChangeGroup } from './types'

const tEn = (k: string) => translations.en[k] ?? k

/** A change older than this stops being news: no task, and Chimmy lists it without the "unseen" mark. */
export const RULE_CHANGE_NEWS_DAYS = 14

/** How many change cards Chimmy is told about. */
export const CHIMMY_RULE_CHANGE_LIMIT = 5

/** One change card as English sentences, joined. */
export function changeGroupSentence(group: ChangeGroup): string {
  return group.lines.map((l) => renderChangeLine(l, tEn, 'en')).join(' ')
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).format(d)
}

/** The newest card's last event: what a member must have seen to be "up to date". */
function lastEvent(group: ChangeGroup): { id: string; createdAt: string } {
  return { id: group.lastEventId, createdAt: group.lastAt }
}

/**
 * The Chimmy block: the league's recent rule changes, newest first. Empty when there are none, so a
 * league with no history adds nothing to the prompt.
 *
 * ⚠ CHIMMY EXPLAINS THESE, IT DOES NOT ENFORCE THEM, and the header says so — the same contract every
 * other league-context block in the chat route carries. The sentences are the card's own, so Chimmy
 * cannot describe a change differently from how the league home shows it.
 */
export function ruleChangesForChimmy(input: {
  groups: readonly ChangeGroup[]
  /** The asking manager's seen marker; null when it could not be read (nothing is marked unseen). */
  seen: LeagueRulesSeen | null
  now: Date
}): string {
  const groups = input.groups.slice(0, CHIMMY_RULE_CHANGE_LIMIT)
  if (!groups.length) return ''
  const fresh = input.now.getTime() - RULE_CHANGE_NEWS_DAYS * 86_400_000
  const lines = groups.map((g) => {
    const unseen = input.seen != null && Date.parse(g.lastAt) >= fresh && !isSettingsEventSeen(lastEvent(g), input.seen)
    return `- ${shortDate(g.lastAt)}${unseen ? ' (this manager has not seen this change yet)' : ''}: ${changeGroupSentence(g)}`
  })
  return [
    '[LEAGUE RULE CHANGES - the commissioner\'s recent rule edits, newest first. Explain them when asked what changed; you never enforce rules.]',
    ...lines,
  ].join('\n')
}

/**
 * Commish OS: members who have not seen the newest change. `members` are the league's managers'
 * user ids, without the commissioners (their own changes are never news to them).
 */
export function detectUnseenRuleChange(input: {
  leagueId: string
  group: ChangeGroup | null
  members: readonly string[]
  seenByUser: ReadonlyMap<string, LeagueRulesSeen>
  /** The league turned commissioner broadcasts off: members get no card, so nothing could clear. */
  broadcastsEnabled: boolean
  now: Date
}): WorkspaceTaskCandidate | null {
  const { group } = input
  if (!group || !input.broadcastsEnabled || !input.members.length) return null
  if (input.now.getTime() - Date.parse(group.lastAt) > RULE_CHANGE_NEWS_DAYS * 86_400_000) return null
  const mark = lastEvent(group)
  const unseen = input.members.filter((id) => {
    const seen = input.seenByUser.get(id)
    return !seen || !isSettingsEventSeen(mark, seen)
  }).length
  if (unseen === 0) return null
  const total = input.members.length
  return {
    // Keyed on the change, not the count: members dropping off update one task rather than opening new ones.
    sourceKey: `rules-unseen:${group.lastEventId}:v1`,
    title: unseen === 1 ? '1 manager has not seen your latest rule change' : `${unseen} managers have not seen your latest rule change`,
    description:
      `${unseen} of ${total} managers have not seen this change yet: ${changeGroupSentence(group)} ` +
      'They get a "What changed" card on the league home the next time they open it. An announcement reaches them sooner.',
    priority: 'advisory',
    automationCandidate: false,
    relatedLinks: [{ label: 'Commissioner Hub', moduleId: 'managers', href: `/core/commissioner?league=${encodeURIComponent(input.leagueId)}` }],
  }
}
