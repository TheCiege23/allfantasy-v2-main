/**
 * CHIMMY'S MANAGER PROFILE — who Chimmy is when it runs a team in season
 * (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 2).
 *
 * A team keeps the personality it drafted with. The 21 draft personalities are draft-shaped, so they
 * are reduced here to a small set of TRAITS the season code reads — one mapping, not 21 code paths:
 *
 *   horizon       -1 this week … +1 the future. How young players and picks weigh against points now.
 *   risk          -1 safe floor … +1 upside. Injured and boom-or-bust players.
 *   activity      how many offers it sends and pickups it makes a week.
 *   fairness      the share of extra value it wants before it says yes to a trade.
 *   positionBias  positions it likes to hold (+) or is happy to sell (−).
 *
 * The commissioner's autopilot STYLE is an explicit choice, so it always sets `horizon`; the
 * personality sets everything else. A team with no personality on record gets one from its roster id —
 * the same one every time, so it never changes between runs.
 *
 * Pure. Nothing here reads or writes; phase 2 only defines the profile, later phases act on it.
 */
import { NPC_DRAFT_PERSONALITIES, isNpcDraftPersonalityId, type NpcDraftPersonalityId } from '@/lib/live-draft-engine/npcDraftPersonalityTypes'
import { DEFAULT_AUTOPILOT_STYLE, type AutopilotStyle } from './inactiveManagerMode'

export const MANAGER_ACTIVITY = ['quiet', 'normal', 'busy'] as const
export type ManagerActivity = (typeof MANAGER_ACTIVITY)[number]

export type ManagerTraits = {
  horizon: number
  risk: number
  activity: ManagerActivity
  fairness: number
  positionBias: Readonly<Record<string, number>>
}

export type ManagerProfile = ManagerTraits & {
  personality: NpcDraftPersonalityId
  style: AutopilotStyle
  /** Where the personality came from: saved on the team, the draft, or picked from the roster id. */
  source: 'saved' | 'draft' | 'assigned'
  /** Plain words for the commissioner's screen. */
  label: string
  summary: string
}

/** Trade offers Chimmy may send a week, by activity. */
export const WEEKLY_OFFER_LIMIT: Record<ManagerActivity, number> = { quiet: 1, normal: 2, busy: 4 }

/** The extra value (share of what it gives up) Chimmy wants before accepting a trade. */
export const FAIRNESS = { easy: 0.03, even: 0.08, tough: 0.15 } as const

/** The style is the commissioner's own choice of horizon. */
export const STYLE_HORIZON: Record<AutopilotStyle, number> = { win_now: -1, dynasty_owner: 0.5, rebuild: 1 }

type PersonalityTraits = Omit<ManagerTraits, 'horizon'> & { label: string; summary: string }

const none: Readonly<Record<string, number>> = {}
const t = (
  label: string,
  summary: string,
  risk: number,
  activity: ManagerActivity,
  fairness: number,
  positionBias: Readonly<Record<string, number>> = none,
): PersonalityTraits => ({ label, summary, risk, activity, fairness, positionBias })

const PERSONALITY_TRAITS: Record<NpcDraftPersonalityId, PersonalityTraits> = {
  BALANCED: t('Balanced', 'Even-handed. Takes fair deals and keeps a steady roster.', 0, 'normal', FAIRNESS.even),
  NEED_BASED: t('Fills needs', 'Shops for whatever the lineup is missing.', 0, 'normal', FAIRNESS.even),
  BEST_PLAYER_AVAILABLE: t('Best player', 'Wants the best player in any deal, whatever the position.', 0, 'normal', FAIRNESS.tough),
  ADP_VALUE_HUNTER: t('Value hunter', 'Hunts bargains and rarely overpays.', -0.2, 'busy', FAIRNESS.tough),
  UPSIDE_SWINGER: t('Swings for upside', 'Chases breakout players and takes chances.', 0.9, 'busy', FAIRNESS.easy),
  FLOOR_SAFE: t('Plays it safe', 'Prefers steady, healthy players. Makes few moves.', -0.9, 'quiet', FAIRNESS.even),
  ZERO_RB: t('Receivers first', 'Builds around receivers and is happy to sell running backs.', 0.2, 'normal', FAIRNESS.even, { WR: 0.25, RB: -0.25 }),
  HERO_RB: t('One star back', 'Keeps one star running back and trades the rest.', 0.1, 'normal', FAIRNESS.even, { RB: 0.1, WR: 0.15 }),
  RB_HEAVY: t('Running backs', 'Collects running backs.', 0, 'normal', FAIRNESS.even, { RB: 0.3 }),
  WR_HEAVY: t('Receivers', 'Collects receivers.', 0, 'normal', FAIRNESS.even, { WR: 0.3 }),
  ELITE_QB: t('Star quarterback', 'Pays up for a top quarterback.', 0, 'normal', FAIRNESS.even, { QB: 0.3 }),
  LATE_QB: t('Waits on quarterback', 'Never pays much for a quarterback.', 0, 'normal', FAIRNESS.even, { QB: -0.3 }),
  EARLY_TE: t('Star tight end', 'Pays up for a top tight end.', 0, 'normal', FAIRNESS.even, { TE: 0.3 }),
  YOUTH_DYNASTY_UPSIDE: t('Young talent', 'Prefers young players with room to grow.', 0.6, 'normal', FAIRNESS.even),
  WIN_NOW_VETERAN: t('Proven veterans', 'Prefers proven players who score now.', -0.4, 'normal', FAIRNESS.even),
  STACK_TEAM_CORRELATION: t('Stacks teammates', 'Likes pairing a quarterback with his receivers.', 0.4, 'normal', FAIRNESS.even, { QB: 0.1, WR: 0.1 }),
  BYE_WEEK_DIVERSIFIER: t('Plans ahead', 'Spreads out bye weeks and keeps depth.', -0.4, 'quiet', FAIRNESS.even),
  INJURY_AVOIDANT: t('Avoids injuries', 'Stays away from hurt players.', -1, 'quiet', FAIRNESS.even),
  CONTRARIAN_CHAOS: t('Wildcard', 'Unpredictable. Makes lots of offers and odd moves.', 1, 'busy', FAIRNESS.easy),
  HOMER_TEAM_FAVORITE: t('Team loyalist', 'Loves players from a favourite team.', 0.2, 'normal', FAIRNESS.easy),
  IDP_SPECIALIST: t('Defense specialist', 'Values defensive players more than most.', 0, 'normal', FAIRNESS.even, { DL: 0.2, LB: 0.2, DB: 0.2 }),
}

function hash(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) h = (h * 31 + input.charCodeAt(i)) >>> 0
  return h
}

/** The personality a team gets when none is on record: fixed by its roster id, so it never changes. */
export function assignedPersonalityFor(rosterId: string): NpcDraftPersonalityId {
  return NPC_DRAFT_PERSONALITIES[hash(`chimmy-manager:${rosterId}`) % NPC_DRAFT_PERSONALITIES.length]!
}

/**
 * The profile Chimmy runs a team with. The personality is, in order: the one saved on the team, the
 * one it drafted with, the one assigned from its roster id.
 */
export function resolveManagerProfile(args: {
  rosterId: string
  style?: AutopilotStyle | null
  savedPersonality?: unknown
  draftPersonality?: unknown
}): ManagerProfile {
  const style = args.style ?? DEFAULT_AUTOPILOT_STYLE
  const [personality, source]: [NpcDraftPersonalityId, ManagerProfile['source']] = isNpcDraftPersonalityId(args.savedPersonality)
    ? [args.savedPersonality, 'saved']
    : isNpcDraftPersonalityId(args.draftPersonality)
      ? [args.draftPersonality, 'draft']
      : [assignedPersonalityFor(args.rosterId), 'assigned']
  return { personality, style, source, horizon: STYLE_HORIZON[style], ...PERSONALITY_TRAITS[personality] }
}

/** How much Chimmy likes holding this position: 0 for one it has no view on. */
export function positionBiasFor(profile: Pick<ManagerTraits, 'positionBias'>, position: string | null | undefined): number {
  return profile.positionBias[String(position ?? '').toUpperCase()] ?? 0
}
