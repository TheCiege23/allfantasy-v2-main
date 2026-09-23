/**
 * League-first mobile — phase 1 of the Sleeper-style redesign.
 *
 * With it on, bare `/core` opens the league the user last had open (its matchup when it has a
 * head-to-head this week, otherwise its league home), the phone tab bar becomes
 * Leagues · Live · Chimmy · Play · Me, and the league name in the top bar opens the league
 * switcher instead of a floating "Leagues" pill.
 *
 * PURE: no I/O, so every decision here is testable by stating the inputs. Reads and writes of the
 * remembered league live in `leagueFirstStore.ts`.
 *
 * ⚠ TWO SWITCHES, AND THE COOKIE WINS. The rollout (`AF_LEAGUE_FIRST_ROLLOUT`, parsed by
 * `parseRolloutEnv`, default 0%) decides for everyone; the `af_league_first` cookie, set by
 * visiting any `/core` URL with `?leagueFirst=on|off` (middleware), overrides it for one browser.
 * The override is what lets the owner try the new shell in production before anyone else sees it,
 * without knowing a user id to allowlist — and lets anyone in the rollout opt back out.
 */

import { evaluateRollout, parseRolloutEnv, type RolloutRule } from '@/lib/sports-os/rollout'

export const LEAGUE_FIRST_FLAG = 'core.league-first-mobile'
export const LEAGUE_FIRST_COOKIE = 'af_league_first'
export const LEAGUE_FIRST_PARAM = 'leagueFirst'
/** `/core?view=all` keeps the cross-league home reachable while league-first is on. */
export const LEAGUE_FIRST_ALL_VIEW = 'all'

export const LEAGUE_FIRST_DEFAULT_RULE: RolloutRule = {
  enabled: true,
  percentage: 0,
  note: 'Phase 1 of the league-first phone shell. Opt in per browser with /core?leagueFirst=on.',
}

/** `'on' | 'off'` from a query value or cookie, anything else is no opinion. */
export function parseLeagueFirstToggle(raw: string | null | undefined): 'on' | 'off' | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (value === 'on' || value === '1' || value === 'true') return 'on'
  if (value === 'off' || value === '0' || value === 'false') return 'off'
  return null
}

export function isLeagueFirstEnabled(args: {
  userId: string | null | undefined
  cookieValue: string | null | undefined
  rolloutEnv: string | null | undefined
}): boolean {
  const override = parseLeagueFirstToggle(args.cookieValue)
  if (override) return override === 'on'
  const rule = parseRolloutEnv(args.rolloutEnv, LEAGUE_FIRST_DEFAULT_RULE)
  return evaluateRollout(LEAGUE_FIRST_FLAG, args.userId, { [LEAGUE_FIRST_FLAG]: rule }).enabled
}

/**
 * Where bare `/core` should send a league-first user, or null to render the cross-league home.
 *
 * ⚠ ONLY A LEAGUE THE USER STILL PLAYS. The remembered id is a hint, not an authorisation: it can
 * name a league they have since left or deleted. It is matched against `playedLeagues`, the same
 * list the page's own `?league=` authorisation check uses, so this can never open a league that
 * check would have stripped.
 *
 * ⚠ THE MATCHUP ONLY WHEN THERE IS ONE. `/core/matchup` with no head-to-head this week falls
 * through to a league picker, which is the opposite of "open my league". A league with no paired
 * fixture this week — pre-draft, offseason, an elimination format — opens on its league home.
 */
export function resolveLeagueFirstLanding(args: {
  lastLeagueId: string | null | undefined
  playedLeagueIds: readonly string[]
  /** League ids with a PAIRED head-to-head this week (rail matchups, `unpaired === false`). */
  headToHeadLeagueIds: ReadonlySet<string>
}): string | null {
  const { lastLeagueId, playedLeagueIds, headToHeadLeagueIds } = args
  let target = lastLeagueId && playedLeagueIds.includes(lastLeagueId) ? lastLeagueId : null
  // One league and no memory yet: there is nothing to choose between.
  if (!target && playedLeagueIds.length === 1) target = playedLeagueIds[0]
  if (!target) return null
  const league = encodeURIComponent(target)
  return headToHeadLeagueIds.has(target) ? `/core/matchup?league=${league}` : `/core?league=${league}`
}
